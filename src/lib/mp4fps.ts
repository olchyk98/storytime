// Minimal MP4/MOV fps extractor. Reads the QuickTime/ISO BMFF box tree to
// find the first video track's media timescale and per-frame sample-delta,
// then computes fps = timescale / sampleDelta.
//
// Why not rely on requestVideoFrameCallback? Chromium can present every-other
// frame for high-bit-depth or HDR clips during the brief play we use for
// fps measurement, so we measure exactly half the real rate. Container-level
// metadata is authoritative and instant — just a few hundred bytes of file
// I/O, no video decode.

const HEAD_BYTES = 1 * 1024 * 1024; // 1MB usually contains moov

interface Box {
  type: string;
  start: number;
  dataStart: number;
  dataEnd: number;
  end: number;
}

function readType(dv: DataView, offset: number): string {
  return String.fromCharCode(
    dv.getUint8(offset),
    dv.getUint8(offset + 1),
    dv.getUint8(offset + 2),
    dv.getUint8(offset + 3)
  );
}

function readBoxHeader(dv: DataView, offset: number): Box | null {
  if (offset + 8 > dv.byteLength) return null;
  let size = dv.getUint32(offset);
  const type = readType(dv, offset + 4);
  let headerSize = 8;
  if (size === 1) {
    if (offset + 16 > dv.byteLength) return null;
    const high = dv.getUint32(offset + 8);
    const low = dv.getUint32(offset + 12);
    size = high * 0x100000000 + low;
    headerSize = 16;
  } else if (size === 0) {
    size = dv.byteLength - offset;
  }
  if (size < headerSize || offset + size > dv.byteLength) {
    // Truncated read — return what we have so callers can decide.
    size = dv.byteLength - offset;
  }
  return {
    type,
    start: offset,
    dataStart: offset + headerSize,
    dataEnd: offset + size,
    end: offset + size,
  };
}

function findChildBox(
  dv: DataView,
  start: number,
  end: number,
  type: string
): Box | null {
  let offset = start;
  while (offset < end) {
    const box = readBoxHeader(dv, offset);
    if (!box) return null;
    if (box.type === type) return box;
    if (box.end <= offset) return null; // guard against infinite loop on bad data
    offset = box.end;
  }
  return null;
}

function countSamplesInTrak(dv: DataView, mdiaStart: number, mdiaEnd: number): number {
  const minf = findChildBox(dv, mdiaStart, mdiaEnd, "minf");
  if (!minf) return 0;
  const stbl = findChildBox(dv, minf.dataStart, minf.dataEnd, "stbl");
  if (!stbl) return 0;
  const stts = findChildBox(dv, stbl.dataStart, stbl.dataEnd, "stts");
  if (!stts || stts.dataStart + 8 > stts.dataEnd) return 0;
  const entryCount = dv.getUint32(stts.dataStart + 4);
  let total = 0;
  let offset = stts.dataStart + 8;
  for (let i = 0; i < entryCount && offset + 8 <= stts.dataEnd; i++) {
    total += dv.getUint32(offset);
    offset += 8;
  }
  return total;
}

// Pick the `vide`-handler track with the most samples. iPhone "Cinematic
// Mode" .movs contain multiple video tracks — the main HEVC video plus
// auxiliary depth/disparity tracks for the focus effect. Selecting the
// largest-by-sample-count one reliably picks the actual content track.
function findVideoTrak(dv: DataView, start: number, end: number): Box | null {
  let bestTrak: Box | null = null;
  let bestSamples = 0;
  let offset = start;
  while (offset < end) {
    const box = readBoxHeader(dv, offset);
    if (!box) break;
    if (box.type === "trak") {
      const mdia = findChildBox(dv, box.dataStart, box.dataEnd, "mdia");
      if (mdia) {
        const hdlr = findChildBox(dv, mdia.dataStart, mdia.dataEnd, "hdlr");
        if (hdlr && hdlr.dataStart + 12 <= hdlr.dataEnd) {
          // hdlr: version(1) + flags(3) + pre_defined(4) + handler_type(4)
          const handlerType = readType(dv, hdlr.dataStart + 8);
          if (handlerType === "vide") {
            const samples = countSamplesInTrak(
              dv,
              mdia.dataStart,
              mdia.dataEnd
            );
            if (samples > bestSamples) {
              bestSamples = samples;
              bestTrak = box;
            }
          }
        }
      }
    }
    if (box.end <= offset) break;
    offset = box.end;
  }
  return bestTrak;
}

function findTopBox(dv: DataView, type: string): Box | null {
  let offset = 0;
  while (offset < dv.byteLength) {
    const box = readBoxHeader(dv, offset);
    if (!box) return null;
    if (box.type === type) return box;
    if (box.end <= offset) return null;
    offset = box.end;
  }
  return null;
}

// Scan a buffer byte-by-byte for the "moov" 4-byte signature with a
// plausible 4-byte size preceding it. Used when reading the tail of an
// mdat-first MP4 (Samsung phones, some screen recorders): the tail buffer
// doesn't start on a box boundary, so findTopBox can't walk from offset 0.
function findMoovBySignature(dv: DataView): Box | null {
  // "moov" = 0x6d 0x6f 0x6f 0x76
  for (let i = 4; i + 8 <= dv.byteLength; i++) {
    if (
      dv.getUint8(i) === 0x6d &&
      dv.getUint8(i + 1) === 0x6f &&
      dv.getUint8(i + 2) === 0x6f &&
      dv.getUint8(i + 3) === 0x76
    ) {
      const boxStart = i - 4;
      const size = dv.getUint32(boxStart);
      // moov is always <2GB in practice and uses a 32-bit size. Sanity-check
      // that the size lands within the buffer and is at least an 8-byte
      // header.
      if (size >= 8 && boxStart + size <= dv.byteLength) {
        return {
          type: "moov",
          start: boxStart,
          dataStart: boxStart + 8,
          dataEnd: boxStart + size,
          end: boxStart + size,
        };
      }
    }
  }
  return null;
}

export interface FpsResult {
  fps: number;
  // Exact rational form from the file. FCP's relink dialog checks that the
  // asset's declared frameDuration is bit-exact with the file's, so we emit
  // sampleDelta/timescale (as integers) verbatim in the FCPXML format.
  sampleDelta: number;
  timescale: number;
  // True when the file has substantially different frame intervals throughout
  // (Snapchat, screen recordings, some social-app exports). FCPXML can't
  // declare a VFR asset cleanly — these need transcoding to CFR before FCP
  // will accept them on relink.
  isVariableFps: boolean;
}

function computeFpsResult(
  dv: DataView,
  trakStart: number,
  trakEnd: number
): FpsResult | null {
  const mdia = findChildBox(dv, trakStart, trakEnd, "mdia");
  if (!mdia) return null;

  const mdhd = findChildBox(dv, mdia.dataStart, mdia.dataEnd, "mdhd");
  if (!mdhd) return null;
  const version = dv.getUint8(mdhd.dataStart);
  const timescaleOffset = mdhd.dataStart + 4 + (version === 1 ? 16 : 8);
  if (timescaleOffset + 4 > mdhd.dataEnd) return null;
  const timescale = dv.getUint32(timescaleOffset);
  if (timescale === 0) return null;

  const minf = findChildBox(dv, mdia.dataStart, mdia.dataEnd, "minf");
  if (!minf) return null;
  const stbl = findChildBox(dv, minf.dataStart, minf.dataEnd, "stbl");
  if (!stbl) return null;
  const stts = findChildBox(dv, stbl.dataStart, stbl.dataEnd, "stts");
  if (!stts) return null;
  if (stts.dataStart + 8 > stts.dataEnd) return null;
  const entryCount = dv.getUint32(stts.dataStart + 4);
  if (entryCount === 0) return null;

  let bestSampleCount = 0;
  let bestDelta = 0;
  let totalSamples = 0;
  let totalTicks = 0;
  // (delta → cumulative sample count) for variance detection.
  const deltaCounts = new Map<number, number>();
  let offset = stts.dataStart + 8;
  for (let i = 0; i < entryCount && offset + 8 <= stts.dataEnd; i++) {
    const sampleCount = dv.getUint32(offset);
    const sampleDelta = dv.getUint32(offset + 4);
    if (sampleDelta > 0) {
      totalSamples += sampleCount;
      totalTicks += sampleCount * sampleDelta;
      deltaCounts.set(
        sampleDelta,
        (deltaCounts.get(sampleDelta) ?? 0) + sampleCount
      );
      if (sampleCount > bestSampleCount) {
        bestSampleCount = sampleCount;
        bestDelta = sampleDelta;
      }
    }
    offset += 8;
  }
  if (bestDelta === 0 || totalSamples === 0) return null;

  // VFR: more than one distinct delta covers a meaningful share (>5%) of
  // frames. Single-entry stts is CFR; multi-entry with ~equal deltas is also
  // effectively CFR (the encoder split into chunks); multi-entry with truly
  // different intervals is VFR.
  let significantBuckets = 0;
  for (const [, count] of deltaCounts) {
    if (count / totalSamples > 0.05) significantBuckets++;
  }
  const isVariableFps = significantBuckets > 1;

  if (isVariableFps) {
    // Real variability — use the file's *average* frame rate, which matches
    // what FCP/AVFoundation reports for VFR clips. Express as the rational
    // form totalTicks / (totalSamples × timescale) seconds.
    let num = totalTicks;
    let den = totalSamples * timescale;
    const g = gcd(num, den);
    if (g > 1) {
      num = Math.floor(num / g);
      den = Math.floor(den / g);
    }
    return {
      fps: den / num,
      sampleDelta: num,
      timescale: den,
      isVariableFps,
    };
  }
  // True CFR (one dominant sample-delta bucket). Reduce by GCD so we emit the
  // *canonical* rational (e.g. 1001/30000 for NTSC 29.97, not 3003/90000) —
  // ffprobe / FCP / AVFoundation all normalize to reduced form before
  // comparing, so we must match that. Mathematically equivalent values in
  // non-canonical form don't pass FCP's relink check.
  let cfrNum = bestDelta;
  let cfrDen = timescale;
  const cfrG = gcd(cfrNum, cfrDen);
  if (cfrG > 1) {
    cfrNum = Math.floor(cfrNum / cfrG);
    cfrDen = Math.floor(cfrDen / cfrG);
  }
  return {
    fps: cfrDen / cfrNum,
    sampleDelta: cfrNum,
    timescale: cfrDen,
    isVariableFps,
  };
}

function gcd(a: number, b: number): number {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) {
    [a, b] = [b, a % b];
  }
  return a;
}

// ── SPS VUI bitstream parsing ────────────────────────────────────────────
// AVFoundation derives `nominalFrameRate` (what FCP's relink check compares
// against) from the H.264/H.265 SPS's VUI timing_info fields. The container's
// stts atom can disagree by tens of millihertz for slightly-VFR clips.
// We extract `num_units_in_tick` and `time_scale` directly from the SPS NAL
// stored inside the avcC (H.264) or hvcC (H.265) box.

class BitReader {
  private buf: Uint8Array;
  private byteOffset = 0;
  private bitOffset = 0;
  constructor(buf: Uint8Array) {
    this.buf = buf;
  }
  bitsLeft(): number {
    return (this.buf.length - this.byteOffset) * 8 - this.bitOffset;
  }
  readBit(): number {
    if (this.byteOffset >= this.buf.length) return 0;
    const b = (this.buf[this.byteOffset] >> (7 - this.bitOffset)) & 1;
    this.bitOffset++;
    if (this.bitOffset === 8) {
      this.bitOffset = 0;
      this.byteOffset++;
    }
    return b;
  }
  readBits(n: number): number {
    let v = 0;
    for (let i = 0; i < n; i++) v = (v << 1) | this.readBit();
    return v;
  }
  // Unsigned Exp-Golomb code (ue(v) in the spec).
  readUe(): number {
    let zeros = 0;
    while (this.bitsLeft() > 0 && this.readBit() === 0 && zeros < 32) zeros++;
    if (zeros === 0) return 0;
    return (1 << zeros) - 1 + this.readBits(zeros);
  }
  // Signed Exp-Golomb (se(v) in the spec).
  readSe(): number {
    const u = this.readUe();
    if (u === 0) return 0;
    return (u & 1) === 1 ? Math.ceil(u / 2) : -Math.floor(u / 2);
  }
}

// Strip H.264/H.265 emulation-prevention bytes (0x000003 → 0x0000).
function stripEmulation(nalu: Uint8Array): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < nalu.length; i++) {
    if (
      i + 2 < nalu.length &&
      nalu[i] === 0 &&
      nalu[i + 1] === 0 &&
      nalu[i + 2] === 3
    ) {
      out.push(0, 0);
      i += 2;
    } else {
      out.push(nalu[i]);
    }
  }
  return new Uint8Array(out);
}

interface VuiTiming {
  numUnitsInTick: number;
  timeScale: number;
}

// Parse an H.264 SPS NAL payload (after the 1-byte NAL header) up to the
// VUI's timing_info. Returns null if VUI/timing absent or stream malformed.
function parseSpsH264(payload: Uint8Array): VuiTiming | null {
  const br = new BitReader(payload);
  try {
    const profile_idc = br.readBits(8);
    br.readBits(8); // constraint_set flags + reserved
    br.readBits(8); // level_idc
    br.readUe(); // seq_parameter_set_id

    if (
      profile_idc === 100 ||
      profile_idc === 110 ||
      profile_idc === 122 ||
      profile_idc === 244 ||
      profile_idc === 44 ||
      profile_idc === 83 ||
      profile_idc === 86 ||
      profile_idc === 118 ||
      profile_idc === 128 ||
      profile_idc === 138 ||
      profile_idc === 139 ||
      profile_idc === 134 ||
      profile_idc === 135
    ) {
      const chroma_format_idc = br.readUe();
      if (chroma_format_idc === 3) br.readBit(); // separate_colour_plane_flag
      br.readUe(); // bit_depth_luma_minus8
      br.readUe(); // bit_depth_chroma_minus8
      br.readBit(); // qpprime_y_zero_transform_bypass_flag
      const seq_scaling_matrix_present_flag = br.readBit();
      if (seq_scaling_matrix_present_flag) {
        const n = chroma_format_idc !== 3 ? 8 : 12;
        for (let i = 0; i < n; i++) {
          const present = br.readBit();
          if (present) skipScalingListH264(br, i < 6 ? 16 : 64);
        }
      }
    }
    br.readUe(); // log2_max_frame_num_minus4
    const pic_order_cnt_type = br.readUe();
    if (pic_order_cnt_type === 0) {
      br.readUe(); // log2_max_pic_order_cnt_lsb_minus4
    } else if (pic_order_cnt_type === 1) {
      br.readBit(); // delta_pic_order_always_zero_flag
      br.readSe(); // offset_for_non_ref_pic
      br.readSe(); // offset_for_top_to_bottom_field
      const n = br.readUe();
      for (let i = 0; i < n; i++) br.readSe();
    }
    br.readUe(); // max_num_ref_frames
    br.readBit(); // gaps_in_frame_num_value_allowed_flag
    br.readUe(); // pic_width_in_mbs_minus1
    br.readUe(); // pic_height_in_map_units_minus1
    const frame_mbs_only_flag = br.readBit();
    if (!frame_mbs_only_flag) br.readBit(); // mb_adaptive_frame_field_flag
    br.readBit(); // direct_8x8_inference_flag
    const frame_cropping_flag = br.readBit();
    if (frame_cropping_flag) {
      br.readUe(); // crop left
      br.readUe(); // crop right
      br.readUe(); // crop top
      br.readUe(); // crop bottom
    }
    const vui_parameters_present_flag = br.readBit();
    if (!vui_parameters_present_flag) return null;

    // vui_parameters()
    const aspect_ratio_info_present_flag = br.readBit();
    if (aspect_ratio_info_present_flag) {
      const aspect_ratio_idc = br.readBits(8);
      if (aspect_ratio_idc === 255) {
        br.readBits(16); // sar_width
        br.readBits(16); // sar_height
      }
    }
    if (br.readBit()) br.readBit(); // overscan
    if (br.readBit()) {
      // video_signal_type
      br.readBits(3); // video_format
      br.readBit(); // video_full_range_flag
      if (br.readBit()) {
        br.readBits(8); // colour_primaries
        br.readBits(8); // transfer_characteristics
        br.readBits(8); // matrix_coefficients
      }
    }
    if (br.readBit()) {
      // chroma_loc_info
      br.readUe();
      br.readUe();
    }
    const timing_info_present_flag = br.readBit();
    if (!timing_info_present_flag) return null;
    const num_units_in_tick = br.readBits(32);
    const time_scale = br.readBits(32);
    return { numUnitsInTick: num_units_in_tick, timeScale: time_scale };
  } catch {
    return null;
  }
}

function skipScalingListH264(br: BitReader, size: number) {
  let lastScale = 8;
  let nextScale = 8;
  for (let j = 0; j < size; j++) {
    if (nextScale !== 0) {
      const delta = br.readSe();
      nextScale = (lastScale + delta + 256) % 256;
    }
    lastScale = nextScale === 0 ? lastScale : nextScale;
  }
}

// Parse an H.265 SPS NAL payload (after the 2-byte NAL header) up to the
// VUI's timing_info. Returns null if VUI/timing absent or stream malformed.
function parseSpsH265(payload: Uint8Array): VuiTiming | null {
  const br = new BitReader(payload);
  try {
    br.readBits(4); // sps_video_parameter_set_id
    const sps_max_sub_layers_minus1 = br.readBits(3);
    br.readBit(); // sps_temporal_id_nesting_flag

    // profile_tier_level(1, sps_max_sub_layers_minus1)
    skipProfileTierLevel(br, sps_max_sub_layers_minus1);

    br.readUe(); // sps_seq_parameter_set_id
    const chroma_format_idc = br.readUe();
    if (chroma_format_idc === 3) br.readBit(); // separate_colour_plane_flag

    br.readUe(); // pic_width_in_luma_samples
    br.readUe(); // pic_height_in_luma_samples
    if (br.readBit()) {
      br.readUe();
      br.readUe();
      br.readUe();
      br.readUe();
    }
    br.readUe(); // bit_depth_luma_minus8
    br.readUe(); // bit_depth_chroma_minus8
    const log2_max_pic_order_cnt_lsb_minus4 = br.readUe();
    const sps_sub_layer_ordering_info_present_flag = br.readBit();
    const start = sps_sub_layer_ordering_info_present_flag
      ? 0
      : sps_max_sub_layers_minus1;
    for (let i = start; i <= sps_max_sub_layers_minus1; i++) {
      br.readUe(); // sps_max_dec_pic_buffering_minus1
      br.readUe(); // sps_max_num_reorder_pics
      br.readUe(); // sps_max_latency_increase_plus1
    }
    br.readUe(); // log2_min_luma_coding_block_size_minus3
    br.readUe(); // log2_diff_max_min_luma_coding_block_size
    br.readUe(); // log2_min_luma_transform_block_size_minus2
    br.readUe(); // log2_diff_max_min_luma_transform_block_size
    br.readUe(); // max_transform_hierarchy_depth_inter
    br.readUe(); // max_transform_hierarchy_depth_intra
    if (br.readBit()) {
      // scaling_list_enabled
      if (br.readBit()) skipScalingListH265(br); // sps_scaling_list_data_present
    }
    br.readBit(); // amp_enabled_flag
    br.readBit(); // sample_adaptive_offset_enabled_flag
    if (br.readBit()) {
      // pcm_enabled_flag
      br.readBits(4); // pcm_sample_bit_depth_luma_minus1
      br.readBits(4); // pcm_sample_bit_depth_chroma_minus1
      br.readUe();
      br.readUe();
      br.readBit(); // pcm_loop_filter_disabled_flag
    }
    const num_short_term_ref_pic_sets = br.readUe();
    // Parse RPS structures, tracking NumDeltaPocs across them so we can
    // correctly consume the inter-prediction variant. Any encoder produces
    // a non-zero num_short_term_ref_pic_sets, so we have to do this in full.
    const numDeltaPocs: number[] = [];
    for (let i = 0; i < num_short_term_ref_pic_sets; i++) {
      let inter = 0;
      if (i !== 0) inter = br.readBit();
      let delta = 0;
      if (inter) {
        // In SPS context, delta_idx_minus1 isn't read (only in slice headers
        // when stRpsIdx == num_short_term_ref_pic_sets). Default refIdx = i - 1.
        br.readBit(); // delta_rps_sign
        br.readUe(); // abs_delta_rps_minus1
        const refIdx = i - 1;
        const refDelta = refIdx >= 0 ? numDeltaPocs[refIdx] : 0;
        for (let j = 0; j <= refDelta; j++) {
          const used = br.readBit();
          let useDelta = 1;
          if (!used) useDelta = br.readBit();
          if (used || useDelta) delta++;
        }
      } else {
        const negPics = br.readUe();
        const posPics = br.readUe();
        for (let k = 0; k < negPics; k++) {
          br.readUe();
          br.readBit();
        }
        for (let k = 0; k < posPics; k++) {
          br.readUe();
          br.readBit();
        }
        delta = negPics + posPics;
      }
      numDeltaPocs.push(delta);
    }
    if (br.readBit()) {
      // long_term_ref_pics_present
      const num_long_term_ref_pics_sps = br.readUe();
      const ltBits = log2_max_pic_order_cnt_lsb_minus4 + 4;
      for (let i = 0; i < num_long_term_ref_pics_sps; i++) {
        br.readBits(ltBits); // lt_ref_pic_poc_lsb_sps[i]
        br.readBit(); // used_by_curr_pic_lt_sps_flag[i]
      }
    }
    br.readBit(); // sps_temporal_mvp_enabled_flag
    br.readBit(); // strong_intra_smoothing_enabled_flag

    const vui_parameters_present_flag = br.readBit();
    if (!vui_parameters_present_flag) return null;

    // vui_parameters()
    if (br.readBit()) {
      // aspect_ratio_info_present_flag
      const aspect_ratio_idc = br.readBits(8);
      if (aspect_ratio_idc === 255) {
        br.readBits(16);
        br.readBits(16);
      }
    }
    if (br.readBit()) br.readBit(); // overscan
    if (br.readBit()) {
      // video_signal_type
      br.readBits(3);
      br.readBit();
      if (br.readBit()) {
        br.readBits(8);
        br.readBits(8);
        br.readBits(8);
      }
    }
    if (br.readBit()) {
      // chroma_loc_info
      br.readUe();
      br.readUe();
    }
    br.readBit(); // neutral_chroma_indication_flag
    br.readBit(); // field_seq_flag
    br.readBit(); // frame_field_info_present_flag
    if (br.readBit()) {
      // default_display_window_flag
      br.readUe();
      br.readUe();
      br.readUe();
      br.readUe();
    }
    const vui_timing_info_present_flag = br.readBit();
    if (!vui_timing_info_present_flag) return null;
    const num_units_in_tick = br.readBits(32);
    const time_scale = br.readBits(32);
    return { numUnitsInTick: num_units_in_tick, timeScale: time_scale };
  } catch {
    return null;
  }
}

function skipProfileTierLevel(br: BitReader, maxNumSubLayersMinus1: number) {
  // general_profile_space(2) + general_tier_flag(1) + general_profile_idc(5)
  br.readBits(8);
  br.readBits(32); // general_profile_compatibility_flag
  br.readBit(); // general_progressive_source_flag
  br.readBit(); // general_interlaced_source_flag
  br.readBit(); // general_non_packed_constraint_flag
  br.readBit(); // general_frame_only_constraint_flag
  br.readBits(43); // general reserved/constraint bits
  br.readBit(); // general_inbld_flag (or reserved)
  br.readBits(8); // general_level_idc
  const sub_layer_profile_present_flag: number[] = [];
  const sub_layer_level_present_flag: number[] = [];
  for (let i = 0; i < maxNumSubLayersMinus1; i++) {
    sub_layer_profile_present_flag.push(br.readBit());
    sub_layer_level_present_flag.push(br.readBit());
  }
  if (maxNumSubLayersMinus1 > 0) {
    for (let i = maxNumSubLayersMinus1; i < 8; i++) br.readBits(2);
  }
  for (let i = 0; i < maxNumSubLayersMinus1; i++) {
    if (sub_layer_profile_present_flag[i]) {
      br.readBits(8);
      br.readBits(32);
      br.readBit();
      br.readBit();
      br.readBit();
      br.readBit();
      br.readBits(43);
      br.readBit();
    }
    if (sub_layer_level_present_flag[i]) br.readBits(8);
  }
}

function skipScalingListH265(br: BitReader) {
  for (let sizeId = 0; sizeId < 4; sizeId++) {
    for (let matrixId = 0; matrixId < 6; matrixId += sizeId === 3 ? 3 : 1) {
      const flag = br.readBit();
      if (!flag) {
        br.readUe();
      } else {
        const coefNum = Math.min(64, 1 << (4 + (sizeId << 1)));
        if (sizeId > 1) br.readSe();
        for (let i = 0; i < coefNum; i++) br.readSe();
      }
    }
  }
}

// Read SPS NAL bytes from the avcC box. avcC layout:
//   configurationVersion(1), AVCProfileIndication(1), profile_compatibility(1),
//   AVCLevelIndication(1), reserved(6 bits) + lengthSizeMinusOne(2),
//   reserved(3) + numOfSequenceParameterSets(5),
//   then [ sequenceParameterSetLength(16), sequenceParameterSetNALUnit ]
// Returns the payload after the 1-byte NAL header.
function readSpsFromAvcC(dv: DataView, avcCStart: number, avcCEnd: number): Uint8Array | null {
  let p = avcCStart + 5; // skip first 5 bytes (config version etc.)
  if (p >= avcCEnd) return null;
  const numSps = dv.getUint8(p) & 0x1f;
  p += 1;
  if (numSps === 0) return null;
  if (p + 2 > avcCEnd) return null;
  const spsLen = dv.getUint16(p);
  p += 2;
  if (p + spsLen > avcCEnd || spsLen < 2) return null;
  const nalu = new Uint8Array(dv.buffer, dv.byteOffset + p, spsLen);
  return stripEmulation(nalu).slice(1); // strip the 1-byte NAL header
}

// Read SPS NAL bytes from the hvcC box. hvcC layout (simplified):
//   configurationVersion(1), profile_space + tier_flag + profile_idc(1),
//   general_profile_compatibility_flags(4), constraint_indicator_flags(6),
//   level_idc(1), reserved + min_spatial_segmentation(2),
//   parallelism_type(1), chroma_format(1), bit_depth_luma(1),
//   bit_depth_chroma(1), avgFrameRate(2), constant_frame_rate + num_temporal_layers
//     + temporal_id_nested + lengthSizeMinusOne(1),
//   numOfArrays(1),
//   for each array: array_completeness + nal_unit_type(1), numNalus(2),
//     for each nalu: nalUnitLength(2), nalUnit[nalUnitLength]
// We look for the array with nal_unit_type == 33 (SPS_NUT).
function readSpsFromHvcC(dv: DataView, hvcCStart: number, hvcCEnd: number): Uint8Array | null {
  let p = hvcCStart + 22;
  if (p >= hvcCEnd) return null;
  const numArrays = dv.getUint8(p);
  p += 1;
  for (let a = 0; a < numArrays; a++) {
    if (p + 3 > hvcCEnd) return null;
    const nalUnitType = dv.getUint8(p) & 0x3f;
    p += 1;
    const numNalus = dv.getUint16(p);
    p += 2;
    for (let n = 0; n < numNalus; n++) {
      if (p + 2 > hvcCEnd) return null;
      const nalLen = dv.getUint16(p);
      p += 2;
      if (p + nalLen > hvcCEnd) return null;
      if (nalUnitType === 33 && nalLen >= 2) {
        const nalu = new Uint8Array(dv.buffer, dv.byteOffset + p, nalLen);
        return stripEmulation(nalu).slice(2); // strip 2-byte HEVC NAL header
      }
      p += nalLen;
    }
  }
  return null;
}

// Try to extract VUI timing from a video track's sample description.
function tryVuiTiming(
  dv: DataView,
  trakStart: number,
  trakEnd: number
): VuiTiming | null {
  const mdia = findChildBox(dv, trakStart, trakEnd, "mdia");
  if (!mdia) return null;
  const minf = findChildBox(dv, mdia.dataStart, mdia.dataEnd, "minf");
  if (!minf) return null;
  const stbl = findChildBox(dv, minf.dataStart, minf.dataEnd, "stbl");
  if (!stbl) return null;
  const stsd = findChildBox(dv, stbl.dataStart, stbl.dataEnd, "stsd");
  if (!stsd) return null;
  // stsd: version(1) + flags(3) + entry_count(4) + entries...
  // Each entry starts with size(4) + type(4) + (entry-specific fields).
  // We look inside the first entry for an avcC or hvcC sub-box.
  let p = stsd.dataStart + 8;
  if (p + 8 > stsd.dataEnd) return null;
  const entrySize = dv.getUint32(p);
  if (entrySize < 8 || p + entrySize > stsd.dataEnd) return null;
  const entryEnd = p + entrySize;
  // Visual sample entry header is 78 bytes after the box header (size+type=8).
  // Sub-boxes (avcC/hvcC) start at offset 78 + 8 = 86 from box header start.
  const subBoxStart = p + 86;
  const avcC = findChildBox(dv, subBoxStart, entryEnd, "avcC");
  if (avcC) {
    const sps = readSpsFromAvcC(dv, avcC.dataStart, avcC.dataEnd);
    if (sps) {
      const t = parseSpsH264(sps);
      if (t && t.timeScale > 0 && t.numUnitsInTick > 0) return t;
    }
  }
  const hvcC = findChildBox(dv, subBoxStart, entryEnd, "hvcC");
  if (hvcC) {
    const sps = readSpsFromHvcC(dv, hvcC.dataStart, hvcC.dataEnd);
    if (sps) {
      const t = parseSpsH265(sps);
      if (t && t.timeScale > 0 && t.numUnitsInTick > 0) return t;
    }
  }
  return null;
}

export async function getFpsFromContainer(
  file: File
): Promise<FpsResult | null> {
  if (file.size < 16) return null;
  // Try the head first — fast-start MP4s and most MOVs have moov early.
  let buf = await file.slice(0, Math.min(HEAD_BYTES, file.size)).arrayBuffer();
  let dv = new DataView(buf);
  let moov = findTopBox(dv, "moov");
  if (!moov) {
    // mdat-first MP4 (Samsung, some screen recorders): moov lives at the
    // end. The tail buffer doesn't start on a box boundary, so we scan for
    // the "moov" signature instead of walking from offset 0.
    const tailSize = Math.min(HEAD_BYTES, file.size);
    buf = await file.slice(file.size - tailSize, file.size).arrayBuffer();
    dv = new DataView(buf);
    moov = findMoovBySignature(dv);
    if (!moov) return null;
  }
  const trak = findVideoTrak(dv, moov.dataStart, moov.dataEnd);
  if (!trak) return null;

  // Primary source: SPS VUI timing. This is what AVFoundation reads to
  // compute `nominalFrameRate`, and what FCP's relink check compares
  // against. Falls through to the stts-based avg/modal computation when
  // the codec isn't H.264/H.265, the SPS has no VUI, or parsing fails.
  const vui = tryVuiTiming(dv, trak.dataStart, trak.dataEnd);
  if (vui) {
    // Per the H.264/H.265 spec: when nuit_field_based_flag is 1 (the modern
    // common case), num_units_in_tick is in field units, so frame rate is
    // time_scale / (2 × num_units_in_tick). When 0, it's a frame tick and
    // frame rate is time_scale / num_units_in_tick. The flag isn't reliably
    // exposed in many encoders, so we use the AVFoundation-style heuristic:
    // pick whichever interpretation yields a plausible video rate (5..300).
    let num = vui.numUnitsInTick * 2;
    let den = vui.timeScale;
    let fps = den / num;
    if (fps < 5 || fps > 300) {
      // Try frame-tick interpretation.
      num = vui.numUnitsInTick;
      fps = den / num;
    }
    if (fps >= 5 && fps <= 300) {
      const g = gcd(num, den);
      const finalNum = g > 1 ? Math.floor(num / g) : num;
      const finalDen = g > 1 ? Math.floor(den / g) : den;
      return {
        fps: finalDen / finalNum,
        sampleDelta: finalNum,
        timescale: finalDen,
        isVariableFps: false,
      };
    }
  }
  return computeFpsResult(dv, trak.dataStart, trak.dataEnd);
}
