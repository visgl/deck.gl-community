// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/**
 * The film, from frames to a verified MP4, and the checks that gate it.
 *
 *   yarn node dev/tree-lifecycle/export.mjs --cycle 1 --width 1080 --height 1920 --samples 16 \
 *     --out file.mp4
 *   yarn node dev/tree-lifecycle/export.mjs --check-seam 1 --width 540 --height 960 --samples 1
 *   yarn node dev/tree-lifecycle/export.mjs --check-loop file.mp4
 *
 * Playwright Chromium on the real GPU renders each frame with `renderAt`, flattens it with its
 * overlay and encodes it with `VideoEncoder` to VP9. Those chunks stream to ffmpeg as an IVF, a
 * segment at a time, and it encodes H.264 in two passes to an average bitrate: an MP4 the size of
 * an upload, not of a master. `verify-export.py` checks the encoded result.
 *
 * `--cycle 1` is the film as it is posted: exactly one cycle in the file's order, from
 * `LOOP.fileStart` (61.3) on round to 125.3, every time taken mod the cycle by the stage, so 1,920
 * frames at 30 fps whose last runs on into its first. Its H.264 has closed GOPs of 60 frames, so
 * each divides 1,920, constant-frame-rate timestamps from 0 and no edit list. Its B-frames have no
 * pyramid, and a run too short for a reader to place them, as one of 3 frames, is encoded again
 * without them. The seam check runs before any frame is rendered, and the loop check on the MP4
 * after it, with the wrap's picture judged from the parts; either failing fails the export
 * (`--gates 0` skips both). Without `--cycle`, `--from` and `--to` are any stretch of story time,
 * past the end of the cycle too, as `--from 63 --to 65` runs through the swap.
 *
 * `--check-seam 1` alone checks the hidden swap at the size and samples given: frames at seam -1/60
 * and +1/60 s composed from the end world and from the start world, with no overlay or grain, must
 * be at least `SEAM_CHECK.leastPsnr` (42) dB alike; and every sub-frame, at its time, lens position
 * and pixel offset, of every frame inside `LOOP.cover` drawn with only the orange over a clear
 * colour no layer draws must show none of that colour.
 *
 * `--check-loop FILE` alone checks any MP4, decoded: the pair where it starts over, the wrap (its
 * last frame and its first, for a file of one cycle), and the pair across the swap, each against
 * the 8 pairs either side of it, its 16 neighbouring steps, by `LOOP_CHECK`, over the whole frame
 * and over the overlay's band. By the MAD rule a pair's MAD is at least 0.5 and at most 1.3 times
 * their median, so it neither freezes nor jumps, and by the SSIM rule its SSIM at least their
 * median less 0.01.
 *
 * - The swap keeps both rules.
 * - The wrap's picture keeps both rules, rule 1, wherever an export's intermediate is at hand: in
 *   an export, from its parts, and with `--parts FOLDER`, from that export's parts. The frames
 *   about the wrap are decoded from the VP9 segments that hold them, streamed to ffmpeg as an IVF.
 *   This gates the picture strictly.
 * - The wrap as the MP4 has it keeps rule 2: the MAD rule, and in place of the SSIM rule, which is
 *   measured and reported only, an SSIM dip below its neighbours' median no deeper than the deepest
 *   such dip at the file's own internal key-frame steps, the steps into every IDR frame but frame
 *   0, as the stream has them, plus 0.005, over the whole frame and over the band. Their median,
 *   90th percentile and deepest are reported beside it. The H.264's GOPs are closed, so every step
 *   into an IDR frame dips in SSIM below its neighbours, and the wrap is one, into frame 0: the
 *   SSIM rule fails any such encode of the film, whatever its picture does. With the parts, each
 *   key-frame step's dip is the MP4's less the picture's there, the encoder's own share, so a dip
 *   that is the picture's, as the band's 0.25 at 1259 to 1260, does not widen the wrap's
 *   allowance; and the allowance is never wider than the MP4's own dips make it. A wrap that is not
 *   a step into a key frame, as a short run's inside its one GOP, or one in a file with no other
 *   key-frame step, may dip no more than 0.01, as the SSIM rule has it.
 * - Across the wrap and across the swap, each two-frame step, 1918 to 0 and 1919 to 1, and 79 to 81
 *   and 80 to 82, has a MAD of at least 0.7 times the median of its 16 neighbouring two-frame
 *   steps', on the picture where the parts are at hand and on the MP4 where not. Motion that runs
 *   back into a pair and out again, a bounce, keeps the MAD and SSIM rules, which are the same
 *   either way; two frames apart, it shows the same picture.
 *
 * With the parts, in an export or with `--parts`, the MP4 is held to them before its pairs are
 * judged: its frames 0, the middle and the last, 960 and 1919 of a cycle, and the frames of the
 * wrap's and the swap's two-frame steps, decoded from both as they are coded, must each be at
 * least 35 dB alike over Y, U and V (`getYuvPsnr`), or the check stops with an error that the
 * parts are not this file's. The film's MP4 at 5 Mbps is 36.8 dB or more from its VP9 there; RGB
 * would read it about 4 dB lower.
 *
 * A cycle file, whose export wrote `cycle=1` in its comment, or one with no export's comment
 * checked without `--from`, must have exactly one cycle's frames, 1,920 at 30 fps, or the check
 * fails: a frame too few or too many and its last frame does not run on into its first.
 *
 * The check ends PASS, exit code 0, when every rule holds with the picture judged; FAIL, exit code
 * 1, when one does not, or there is nothing to judge, as an error does too; and without the parts,
 * when every rule on the MP4 holds, `encoded only: picture not judged`, exit code 2, which is not a
 * pass. An export always has its parts, so its check is PASS or FAIL.
 *
 * Where the file starts in the cycle comes from `--from`, else from what an export writes in its
 * comment, else `LOOP.fileStart`. A short run made for a test, as `--from 60.3 --to 62.3` (the
 * file's last second and its first) or `--from 63 --to 65` (through the swap), has its pair
 * checked inside it. `--check-loop 1` with an export checks the MP4 it makes.
 *
 * Frames go in segments that each start on a key frame. A finished segment is kept in `FILE.parts/`
 * beside the output, so an interrupted export run again with the same options goes on from the
 * first segment it does not have. The folder goes away once the MP4 has passed. Nothing is written
 * anywhere else, and the film is never on disk twice.
 *
 * Options, besides those above:
 *   --fps N                  Frames per second. @default 30
 *   --from, --to SECONDS     The stretch of story time, without --cycle. @default 0, 64
 *   --shutter FRACTION       Of a frame the shutter is open at full speed. Slow motion closes it by
 *                            its time rate, to 0.06 at a rate of 0.12. @default 0.5
 *   --aperture-scale SCALE   Of `camera.aperture`. 0 is a pinhole. @default 1
 *   --adaptive 0             Exactly --samples for every frame. By default that is the least, and
 *                            a frame with a wide lens takes more, up to 4 times as many, as a macro
 *                            shot needs them. The opening's are cheap to draw; the finale's and the
 *                            drop's, with the hero's crown behind the fruit, are the largest cost of
 *                            the cycle, about 27 of its 65 minutes at 1080x1920 and 8 samples.
 *   --query QUERY            More URL parameters of the page, such as `only=sky,ground`.
 *   --segment FRAMES         Frames in a segment. @default 30
 *   --bitrate BITS           Of the VP9 on its way to H.264, per second. @default 40000000
 *   --quantizer Q            Constant quality for the VP9 instead, 0-63. Lower is better, larger.
 *   --h264-bitrate BITS      Of the MP4, per second on average, with peaks of up to twice that.
 *                            @default 5000000, about 38 MB a minute
 *   --crf N                  Constant quality for the MP4 instead, in one pass. 16, with --bitrate
 *                            80000000, makes a master about 5 times the size.
 *   --preset NAME            Of the H.264. @default slower
 *   --keep-parts 1           Keeps `FILE.parts/` after success, with the checks' reports and
 *                            stills.
 *   --keep FOLDER            With --check-seam or --check-loop alone: their stills and reports
 *                            here.
 *   --parts FOLDER           With --check-loop FILE alone: the parts of the export that made FILE,
 *                            `OUT.parts/` as --keep-parts 1 or a failed check leaves it. FILE must
 *                            be of its plan and an encode of its VP9, and the wrap's picture and
 *                            the two-frame steps are judged from that VP9.
 *   --overwrite 1            Replaces an MP4 that is already there.
 *
 * Ends with exit code 1 if the page reports an error, the MP4 does not verify or a check fails, and
 * with 2 if `--check-loop FILE` alone could judge only the encode. The dev server at
 * http://127.0.0.1:4393 is used if it is up, else one is started and stopped on a free port.
 */

import {execFileSync, spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs';
import {homedir} from 'node:os';
import {basename, dirname, resolve} from 'node:path';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {loadStoryClock} from './capture.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPOSITORY = resolve(HERE, '../..');
const DEFAULT_SERVER = 'http://127.0.0.1:4393';
const VERIFY_SCRIPT = resolve(homedir(), '.codex/skills/deck-render/scripts/verify-export.py');
const SEGMENT_SUFFIX = '.segment';
/** Frames in a closed GOP of the H.264: 1,920 frames are 32 of them. */
const GOP_FRAMES = 60;
/** What an export writes in the MP4's comment, so the loop check knows where the file starts. */
const COMMENT_MARK = 'thirty-years';
/** Files whose content is the film, for a fingerprint of what a set of parts came from. */
const SOURCE_FOLDERS = [
  resolve(HERE, 'stage'),
  resolve(HERE, 'story'),
  resolve(HERE, 'layers'),
  resolve(REPOSITORY, 'modules/layers/src/tree-layer')
];
const BROWSER_ARGUMENTS = [
  '--use-angle=metal',
  '--enable-unsafe-webgpu',
  '--ignore-gpu-blocklist',
  '--enable-gpu',
  '--disable-gpu-sandbox',
  // A sub-frame of the storm on a busy GPU may take longer than the watchdog allows.
  '--disable-gpu-watchdog'
];

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    if (!name.startsWith('--') || argv[index + 1] === undefined) {
      throw new Error(`Options come in pairs, --name value. Got ${name}`);
    }
    options[name.slice(2)] = argv[index + 1];
  }
  return options;
}

/** Whether a switch such as `--cycle 1` is on. */
function isOn(value) {
  return value !== undefined && value !== '0';
}

/** Everything that decides what the frames are. A set of parts only goes on under the same plan. */
function getPlan(options, clock) {
  const number = (name, fallback) => {
    const value = Number(options[name] ?? fallback);
    if (!Number.isFinite(value)) throw new Error(`--${name} must be a number`);
    return value;
  };
  const width = number('width', 1920);
  const height = number('height', 1080);
  if (width % 2 || height % 2) throw new Error('--width and --height must be even for yuv420p');
  const fps = number('fps', 30);
  const cycle = isOn(options.cycle);
  if (cycle && (options.from !== undefined || options.to !== undefined)) {
    throw new Error('--cycle is one whole cycle from the file start: leave out --from and --to');
  }
  const from = cycle ? clock.LOOP.fileStart : number('from', 0);
  const to = cycle ? from + clock.CYCLE_SECONDS : number('to', clock.CYCLE_SECONDS);
  const frames = Math.round((to - from) * fps);
  if (frames < 1) throw new Error('--to must be after --from');
  return {
    width,
    height,
    fps,
    cycle,
    from,
    to,
    frames,
    samples: number('samples', 16),
    adaptive: options.adaptive !== '0',
    shutter: number('shutter', 0.5),
    apertureScale: number('aperture-scale', 1),
    segment: number('segment', 30),
    query: options.query ?? '',
    bitrate: options.quantizer === undefined ? number('bitrate', 40e6) : undefined,
    quantizer: options.quantizer === undefined ? undefined : number('quantizer', 8)
  };
}

/** How the MP4 is encoded, checked before any frame is rendered. It does not change the frames. */
function getH264Options(options) {
  const preset = options.preset ?? 'slower';
  if (options.crf !== undefined) {
    const crf = Number(options.crf);
    if (!Number.isFinite(crf)) throw new Error('--crf must be a number');
    return {preset, crf};
  }
  const bitrate = Number(options['h264-bitrate'] ?? 5e6);
  if (!(bitrate > 0)) throw new Error('--h264-bitrate must be a positive number');
  return {preset, bitrate};
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds)) return '?';
  const whole = Math.round(seconds);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const rest = whole % 60;
  return hours > 0
    ? `${hours}h${String(minutes).padStart(2, '0')}m`
    : `${minutes}m${String(rest).padStart(2, '0')}s`;
}

function getFiles(folder) {
  const files = [];
  for (const entry of readdirSync(folder, {withFileTypes: true})) {
    const path = resolve(folder, entry.name);
    if (entry.isDirectory()) files.push(...getFiles(path));
    else files.push(path);
  }
  return files;
}

/** A hash of the sources of the frames, so a report can say if they changed under an export. */
function getSourceFingerprint() {
  const hash = createHash('sha256');
  for (const folder of SOURCE_FOLDERS) {
    if (existsSync(folder)) {
      for (const file of getFiles(folder).sort()) hash.update(file).update(readFileSync(file));
    }
  }
  return hash.digest('hex').slice(0, 16);
}

async function isServerUp(url) {
  try {
    const response = await fetch(`${url}/stage.html`, {signal: AbortSignal.timeout(1000)});
    return response.ok;
  } catch {
    return false;
  }
}

async function getServer() {
  if (await isServerUp(DEFAULT_SERVER)) return {url: DEFAULT_SERVER, close: async () => {}};
  const {createServer} = await import('vite');
  const server = await createServer({
    configFile: resolve(HERE, 'vite.config.ts'),
    server: {port: 0, strictPort: false, host: '127.0.0.1'},
    logLevel: 'warn'
  });
  await server.listen();
  const {port} = server.httpServer.address();
  return {url: `http://127.0.0.1:${port}`, close: () => server.close()};
}

/** A server and a browser for stage pages, and how to close both. */
async function launchStage() {
  const server = await getServer();
  const browser = await chromium.launch({
    headless: true,
    channel: 'chromium',
    args: BROWSER_ARGUMENTS
  });
  return {
    server,
    browser,
    close: async () => {
      await browser.close();
      await server.close();
    }
  };
}

/**
 * A capture page of the stage at the plan's size, with the plan's query and `extra` over it, and
 * the problems it reports.
 */
async function openStagePage(stage, plan, extra = {}) {
  const context = await stage.browser.newContext({
    viewport: {width: plan.width, height: plan.height},
    deviceScaleFactor: 1
  });
  const page = await context.newPage();
  const problems = [];
  page.on('pageerror', error => problems.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') problems.push(message.text());
  });
  const query = new URLSearchParams(plan.query);
  query.set('capture', '1');
  query.set('dpr', '1');
  // Accumulation has no use for the canvas's MSAA, and it costs memory.
  if (plan.samples > 1) query.set('msaa', '0');
  for (const [key, value] of Object.entries(extra)) query.set(key, value);
  await page.goto(`${stage.server.url}/stage.html?${query}`, {waitUntil: 'load', timeout: 180000});
  await page.evaluate(() => window.motionReady);
  return {context, page, problems};
}

function getSegmentPath(partsFolder, firstFrame) {
  return resolve(partsFolder, `${String(firstFrame).padStart(7, '0')}${SEGMENT_SUFFIX}`);
}

/** A segment on disk: for each frame in order, its length as 4 bytes and its bytes. */
function encodeSegmentFile(chunks) {
  const blocks = [];
  for (const {base64} of chunks) {
    const bytes = Buffer.from(base64, 'base64');
    const length = Buffer.alloc(4);
    length.writeUInt32LE(bytes.length, 0);
    blocks.push(length, bytes);
  }
  return Buffer.concat(blocks);
}

/** The first frame of each of the plan's segments, in order. */
function getSegmentStarts(plan) {
  const starts = [];
  for (let firstFrame = 0; firstFrame < plan.frames; firstFrame += plan.segment) {
    starts.push(firstFrame);
  }
  return starts;
}

/**
 * The parts as one IVF, piece by piece: its header, then for each frame a 12-byte header and the
 * frame. One segment is read at a time. `starts` streams only the segments that start at those
 * frames, in that order, each from the key frame it starts on, with their frames counted from 0.
 */
function* getIvfBlocks(plan, partsFolder, starts = getSegmentStarts(plan)) {
  const getSegmentFrames = firstFrame => Math.min(plan.segment, plan.frames - firstFrame);
  const frames = starts.reduce((sum, firstFrame) => sum + getSegmentFrames(firstFrame), 0);
  const header = Buffer.alloc(32);
  header.write('DKIF', 0);
  header.writeUInt16LE(0, 4);
  header.writeUInt16LE(32, 6);
  header.write('VP90', 8);
  header.writeUInt16LE(plan.width, 12);
  header.writeUInt16LE(plan.height, 14);
  // A timebase of 1/fps, in thousandths so that 29.97 stays what it is.
  header.writeUInt32LE(Math.round(plan.fps * 1000), 16);
  header.writeUInt32LE(1000, 20);
  header.writeUInt32LE(frames, 24);
  yield header;
  let frame = 0;
  for (const firstFrame of starts) {
    const data = readFileSync(getSegmentPath(partsFolder, firstFrame));
    const segmentStart = frame;
    let offset = 0;
    while (offset < data.length) {
      const length = data.readUInt32LE(offset);
      const frameHeader = Buffer.alloc(12);
      frameHeader.writeUInt32LE(length, 0);
      frameHeader.writeBigUInt64LE(BigInt(frame), 4);
      yield frameHeader;
      yield data.subarray(offset + 4, offset + 4 + length);
      offset += 4 + length;
      frame++;
    }
    // A frame's place in the stream is its place in its segment, so each must be whole.
    if (frame - segmentStart !== getSegmentFrames(firstFrame)) {
      throw new Error(
        `The segment at frame ${firstFrame} holds ${frame - segmentStart} frames, ` +
          `not ${getSegmentFrames(firstFrame)}`
      );
    }
  }
}

/** Runs ffmpeg on the parts, streamed to it as an IVF, so that the IVF is never a file. */
async function runFfmpeg(plan, partsFolder, outputArguments) {
  const input = ['-v', 'error', '-y', '-f', 'ivf', '-i', 'pipe:0'];
  const ffmpeg = spawn('ffmpeg', [...input, ...outputArguments], {
    stdio: ['pipe', 'inherit', 'inherit']
  });
  const exited = new Promise((resolveExit, rejectExit) => {
    ffmpeg.on('error', rejectExit);
    ffmpeg.on('close', code =>
      code === 0 ? resolveExit() : rejectExit(new Error(`ffmpeg ended with code ${code}`))
    );
  });
  const streamed = pipeline(
    Readable.from(getIvfBlocks(plan, partsFolder), {objectMode: false}),
    ffmpeg.stdin
  );
  // When ffmpeg stops early, its code says why better than the EPIPE of the next write does.
  const [exit, stream] = await Promise.allSettled([exited, streamed]);
  if (exit.status === 'rejected') throw exit.reason;
  if (stream.status === 'rejected') throw stream.reason;
}

/**
 * The first packet of an MP4's video that a reader shows before it decodes it, as FFmpeg reads the
 * file, or null. FFmpeg takes the B-frames' delay from all but the last two `ctts` entries, so a
 * file whose only B-frames are in those, as a run of a few frames can be, has one.
 */
function findEarlyPacket(moviePath) {
  const output = execFileSync(
    'ffprobe',
    [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_entries',
      'packet=pts_time,dts_time',
      '-of',
      'csv=p=0',
      moviePath
    ],
    {maxBuffer: 64 * 1024 * 1024}
  ).toString();
  const packets = output
    .split('\n')
    .filter(Boolean)
    .map(line => line.split(',').slice(0, 2).map(Number));
  const index = packets.findIndex(([pts, dts]) => pts < dts);
  return index < 0 ? null : {index, pts: packets[index][0], dts: packets[index][1]};
}

/**
 * The MP4, with B-frames, or without them if a reader would show one of its frames before it is
 * decoded, which only a run of a few frames comes to.
 */
async function transcode(plan, partsFolder, moviePath, h264) {
  await encodeMovie(plan, partsFolder, moviePath, h264, true);
  const early = findEarlyPacket(moviePath);
  if (early) {
    console.log(
      `ENCODE again without B-frames: packet ${early.index} would show at ${early.pts} s, ` +
        `before it is decoded at ${early.dts} s`
    );
    await encodeMovie(plan, partsFolder, moviePath, h264, false);
  }
}

/** The MP4, in two passes to an average bitrate that each read the parts, or in one at a CRF. */
async function encodeMovie(plan, partsFolder, moviePath, h264, hasBFrames) {
  const video = [
    '-c:v',
    'libx264',
    '-preset',
    h264.preset,
    // Which any phone decodes. It holds `slower` to 4 reference frames, where it would take 8.
    '-level',
    '4.1',
    '-pix_fmt',
    'yuv420p',
    // Closed GOPs of a fixed length, an IDR frame every GOP_FRAMES and nowhere else, so a loop of
    // whole GOPs starts again on a frame that needs nothing before it. B-frames without a pyramid:
    // each is decoded straight after the frame it looks forward to, and shown exactly one frame
    // before it is decoded, so no composition offset is below -1 frame. A pyramid's run of three
    // shows a B two frames early, and a reader that takes the delay from all but the last two
    // `ctts` entries, as FFmpeg's does, then has a frame shown before it is decoded.
    '-flags',
    '+cgop',
    '-x264-params',
    `keyint=${GOP_FRAMES}:min-keyint=${GOP_FRAMES}:scenecut=0:open-gop=0:` +
      (hasBFrames ? 'b-pyramid=none' : 'bframes=0'),
    // VideoEncoder converts with BT.709, but says so only of the matrix. This says all of it.
    '-vf',
    'setparams=range=tv:color_primaries=bt709:color_trc=bt709:colorspace=bt709'
  ];
  // No edit list: the B-frames' delay of one frame goes into negative composition offsets
  // instead, so the first frame shows at 0 and a player looping the file has nothing to skip.
  const movie = [
    '-movflags',
    '+faststart+negative_cts_offsets',
    '-use_editlist',
    '0',
    '-metadata',
    `comment=${COMMENT_MARK} from=${plan.from} fps=${plan.fps}${plan.cycle ? ' cycle=1' : ''}`,
    '-f',
    'mp4',
    moviePath
  ];
  if (h264.crf !== undefined) {
    console.log(`ENCODE H.264 at CRF ${h264.crf}`);
    await runFfmpeg(plan, partsFolder, [...video, '-crf', String(h264.crf), ...movie]);
    return;
  }
  // Busy shots, such as the storm, borrow from calm ones, within what a player buffers.
  const rate = [
    '-b:v',
    String(h264.bitrate),
    '-maxrate',
    String(2 * h264.bitrate),
    '-bufsize',
    String(4 * h264.bitrate),
    '-passlogfile',
    resolve(partsFolder, 'x264')
  ];
  console.log(`ENCODE H.264 at ${h264.bitrate / 1e6} Mbps, pass 1 of 2`);
  await runFfmpeg(plan, partsFolder, [...video, ...rate, '-pass', '1', '-f', 'null', '-']);
  console.log('ENCODE H.264, pass 2 of 2');
  await runFfmpeg(plan, partsFolder, [...video, ...rate, '-pass', '2', ...movie]);
}

/** The verifier's report, which it writes whether the file passes or not. */
function verify(moviePath, plan, reportPath) {
  rmSync(reportPath, {force: true});
  try {
    execFileSync(
      'python3',
      [
        VERIFY_SCRIPT,
        moviePath,
        '--width',
        String(plan.width),
        '--height',
        String(plan.height),
        '--fps',
        String(plan.fps),
        '--frames',
        String(plan.frames),
        '--report',
        reportPath
      ],
      {stdio: 'pipe', maxBuffer: 16 * 1024 * 1024}
    );
  } catch (error) {
    if (!existsSync(reportPath)) throw error;
  }
  return JSON.parse(readFileSync(reportPath, 'utf8'));
}

async function renderSegments(plan, partsFolder, progressPath, clock) {
  const missing = [];
  for (let firstFrame = 0; firstFrame < plan.frames; firstFrame += plan.segment) {
    if (!existsSync(getSegmentPath(partsFolder, firstFrame))) missing.push(firstFrame);
  }
  const framesHave =
    plan.frames -
    missing.reduce((sum, firstFrame) => sum + Math.min(plan.segment, plan.frames - firstFrame), 0);
  if (framesHave > 0) console.log(`RESUME ${framesHave}/${plan.frames} frames already in parts`);
  if (missing.length === 0) return;

  const stage = await launchStage();
  try {
    const {page, problems} = await openStagePage(stage, plan);
    let framesDone = framesHave;
    let framesThisRun = 0;
    const started = Date.now();
    await page.exposeFunction('onExportFrame', ({frame, renderMs, totalMs}) => {
      framesDone++;
      framesThisRun++;
      const elapsed = (Date.now() - started) / 1000;
      const perFrame = elapsed / framesThisRun;
      const left = perFrame * (plan.frames - framesDone);
      // The cycle second it shows, as the page takes it.
      const seconds = clock.getFrameSeconds(plan.from, frame, plan.fps);
      console.log(
        `frame ${frame + 1}/${plan.frames} t=${seconds.toFixed(2)} ` +
          `render ${(renderMs / 1000).toFixed(2)} s, total ${(totalMs / 1000).toFixed(2)} s, ` +
          `mean ${perFrame.toFixed(2)} sec/frame, ${formatDuration(left)} left`
      );
      const progress = {
        frame: framesDone,
        frames: plan.frames,
        secondsPerFrame: perFrame,
        secondsLeft: left
      };
      writeFileSync(progressPath, `${JSON.stringify(progress)}\n`);
    });
    for (const firstFrame of missing) {
      const {chunks, width, height, errors} = await page.evaluate(
        request => window.encodeSegment(request),
        {
          firstFrame,
          frames: Math.min(plan.segment, plan.frames - firstFrame),
          fps: plan.fps,
          from: plan.from,
          samples: plan.samples,
          adaptive: plan.adaptive,
          shutter: plan.shutter,
          apertureScale: plan.apertureScale,
          bitrate: plan.bitrate,
          quantizer: plan.quantizer
        }
      );
      problems.push(...errors);
      if (problems.length > 0) {
        throw new Error(`The page reported:\n${[...new Set(problems)].join('\n')}`);
      }
      if (width !== plan.width || height !== plan.height) {
        throw new Error(`Frames are ${width}x${height}, not ${plan.width}x${plan.height}`);
      }
      if (chunks.length !== Math.min(plan.segment, plan.frames - firstFrame)) {
        throw new Error(`Segment at frame ${firstFrame} has ${chunks.length} chunks`);
      }
      const path = getSegmentPath(partsFolder, firstFrame);
      writeFileSync(`${path}.partial`, encodeSegmentFile(chunks));
      // Only whole segments ever carry the name a later run looks for.
      renameSync(`${path}.partial`, path);
    }
    const elapsed = (Date.now() - started) / 1000;
    const perFrame = (elapsed / framesThisRun).toFixed(2);
    const total = formatDuration(elapsed);
    console.log(`RENDERED ${framesThisRun} frames, ${total}, ${perFrame} sec/frame`);
  } finally {
    await stage.close();
  }
}

// The seam check.

function formatSeam(seam) {
  return `${seam < 0 ? '-' : '+'}${Math.abs(seam).toFixed(4)}`;
}

function writeDataUrl(path, dataUrl) {
  writeFileSync(path, Buffer.from(dataUrl.split(',')[1], 'base64'));
}

/**
 * The hidden swap, checked at the plan's size, samples and shutter: the two worlds alike either
 * side of the swap, and the rind over every pixel of every sub-frame inside `LOOP.cover`. Stills of
 * the worlds go to `folder` when there is one.
 */
async function checkSeam(plan, clock, folder) {
  const {LOOP, SEAM_CHECK, getCycleSeconds} = clock;
  const render = {
    samples: plan.samples,
    adaptive: plan.adaptive,
    shutter: plan.shutter,
    apertureScale: plan.apertureScale,
    fps: plan.fps
  };
  const report = {size: [plan.width, plan.height], samples: plan.samples, worlds: [], cover: []};
  const problems = [];
  const stage = await launchStage();
  try {
    // The two worlds, with no overlay or grain, at each second either side of the swap.
    const worlds = await openStagePage(stage, plan, {overlay: '0'});
    for (const seam of SEAM_CHECK.seams) {
      const t = getCycleSeconds(seam);
      for (const world of ['end', 'start']) {
        const frame = await worlds.page.evaluate(
          ([time, options]) => window.renderAt(time, options),
          [t, {...render, grade: {grain: 0}, world}]
        );
        problems.push(...frame.errors);
        await worlds.page.evaluate(name => window.keepStage(name), world);
        if (folder) {
          const dataUrl = await worlds.page.evaluate(() => window.captureStage());
          writeDataUrl(resolve(folder, `seam-${formatSeam(seam)}-${world}.png`), dataUrl);
        }
      }
      const {mad, psnr} = await worlds.page.evaluate(() => window.compareStage('end', 'start'));
      const pass = psnr >= SEAM_CHECK.leastPsnr;
      report.worlds.push({seam, t, mad, psnr: Number.isFinite(psnr) ? psnr : 'Infinity', pass});
      console.log(
        `SEAM worlds at ${formatSeam(seam)} s: PSNR ${psnr.toFixed(2)} dB, ` +
          `MAD ${mad.toFixed(3)}, ${pass ? 'pass' : 'FAIL'} at ${SEAM_CHECK.leastPsnr} dB`
      );
    }
    problems.push(...worlds.problems);
    await worlds.context.close();

    // Every sub-frame inside the cover, the orange alone over a clear colour, jittered as an
    // export's are.
    const cover = await openStagePage(stage, plan, {only: 'orange', finish: '0', msaa: '0'});
    const first = Math.ceil(LOOP.cover[0] * plan.fps - 1e-9);
    const last = Math.floor(LOOP.cover[1] * plan.fps + 1e-9);
    for (let frame = first; frame <= last; frame++) {
      const seam = frame / plan.fps;
      const result = await cover.page.evaluate(
        ([time, options]) => window.checkCover(time, options),
        [getCycleSeconds(seam), render]
      );
      const worst = Math.max(...result.uncovered);
      const missed = result.uncovered.filter(count => count > 0).length;
      report.cover.push({
        seam,
        t: result.t,
        world: result.world,
        subFrames: result.uncovered.length,
        subFramesMissed: missed,
        mostPixelsMissed: worst,
        share: worst / result.pixels
      });
      console.log(
        `SEAM cover at ${formatSeam(seam)} s (${result.world}): ${result.uncovered.length} ` +
          `sub-frames, ${missed} with sky or ground showing, at most ${worst} of ` +
          `${result.pixels} pixels`
      );
    }
    problems.push(...(await cover.page.evaluate(() => window.stageErrors)), ...cover.problems);
    await cover.context.close();
  } finally {
    await stage.close();
  }
  report.problems = [...new Set(problems)];
  report.pass =
    report.problems.length === 0 &&
    report.worlds.every(world => world.pass) &&
    report.cover.every(frame => frame.subFramesMissed === 0);
  if (folder) writeFileSync(resolve(folder, 'seam.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`SEAM ${report.pass ? 'PASS' : 'FAIL'}`);
  return report;
}

// The loop check.

/** Width, height, frames, frames per second and comment of an MP4's video. */
function probeMovie(moviePath) {
  const output = execFileSync(
    'ffprobe',
    [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-count_frames',
      '-show_entries',
      'stream=width,height,r_frame_rate,nb_read_frames:format_tags=comment',
      '-of',
      'json',
      moviePath
    ],
    {maxBuffer: 16 * 1024 * 1024}
  );
  const {streams, format} = JSON.parse(output);
  const [stream] = streams;
  const [numerator, denominator = 1] = stream.r_frame_rate.split('/').map(Number);
  return {
    width: stream.width,
    height: stream.height,
    frames: Number(stream.nb_read_frames),
    fps: numerator / denominator,
    comment: format?.tags?.comment ?? ''
  };
}

/** The key frames of an MP4's video, by index, and the second its first frame shows at. */
function readFrameTimes(moviePath) {
  const output = execFileSync(
    'ffprobe',
    [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_entries',
      'frame=key_frame,pts_time',
      '-of',
      'csv=p=0',
      moviePath
    ],
    {maxBuffer: 64 * 1024 * 1024}
  ).toString();
  // Each frame in the order it shows, as `key_frame,pts_time`, maybe with side data after.
  const frames = output
    .split('\n')
    .filter(Boolean)
    .map(line => line.split(','));
  return {
    keyFrames: frames.flatMap(([key], index) => (key === '1' ? [index] : [])),
    firstTime: Number(frames[0]?.[1])
  };
}

/** Whether an MP4's `moov` has an edit list, `elst`, in any of its tracks. */
function hasEditList(moviePath) {
  const data = readFileSync(moviePath);
  const containers = new Set(['moov', 'trak', 'edts', 'mdia', 'minf', 'stbl']);
  const walk = (start, end) => {
    for (let offset = start; offset + 8 <= end; ) {
      let size = data.readUInt32BE(offset);
      const type = data.toString('latin1', offset + 4, offset + 8);
      let header = 8;
      if (size === 1) {
        size = Number(data.readBigUInt64BE(offset + 8));
        header = 16;
      } else if (size === 0) {
        size = end - offset;
      }
      if (size < header) return false;
      if (type === 'elst') return true;
      if (containers.has(type) && walk(offset + header, offset + size)) return true;
      offset += size;
    }
    return false;
  };
  return walk(0, data.length);
}

/** An ffmpeg `select` expression for frames by sorted index, in runs: `between(n,51,68)+...`. */
function getFrameSelection(sorted) {
  const runs = [];
  for (const index of sorted) {
    const run = runs.at(-1);
    if (run && index === run[1] + 1) run[1] = index;
    else runs.push([index, index]);
  }
  return runs.map(([first, last]) => `between(n,${first},${last})`).join('+');
}

/** Bytes of one frame of `pixelFormat`, `rgba` or `yuv420p`, at a size. */
function getFrameBytes(pixelFormat, width, height) {
  if (pixelFormat === 'rgba') return width * height * 4;
  if (pixelFormat === 'yuv420p') {
    return width * height + 2 * Math.ceil(width / 2) * Math.ceil(height / 2);
  }
  throw new Error(`No frame size for ${pixelFormat}`);
}

/**
 * Decodes frames by index, as RGBA, or as `pixelFormat`, in one pass of ffmpeg, and hands each to
 * `onFrame` as it comes, in order, so that a caller holds only the frames it keeps. `input` is an
 * MP4's path, or IVF blocks to stream to ffmpeg, as `getIvfBlocks` makes of the parts. Both are
 * coded as yuv420p, so as `yuv420p` a frame is its planes as coded, with nothing converted.
 */
async function decodeFrames(input, indices, {width, height}, onFrame, pixelFormat = 'rgba') {
  const sorted = [...new Set(indices)].sort((a, b) => a - b);
  const streamed = typeof input !== 'string';
  const name = streamed ? 'the parts' : input;
  const ffmpeg = spawn(
    'ffmpeg',
    [
      '-v',
      'error',
      ...(streamed ? ['-f', 'ivf', '-i', 'pipe:0'] : ['-i', input]),
      '-vf',
      `select='${getFrameSelection(sorted)}'`,
      '-fps_mode',
      'passthrough',
      '-f',
      'rawvideo',
      '-pix_fmt',
      pixelFormat,
      'pipe:1'
    ],
    {stdio: [streamed ? 'pipe' : 'ignore', 'pipe', 'inherit']}
  );
  const exited = new Promise((resolveExit, rejectExit) => {
    ffmpeg.on('error', rejectExit);
    ffmpeg.on('close', resolveExit);
  });
  const fed = streamed
    ? pipeline(Readable.from(input, {objectMode: false}), ffmpeg.stdin)
    : Promise.resolve();
  // Settled however the reading goes, so a feed cut short is never an unhandled rejection.
  const settled = Promise.allSettled([exited, fed]);
  const size = getFrameBytes(pixelFormat, width, height);
  let count = 0;
  try {
    let current = Buffer.alloc(size);
    let filled = 0;
    for await (const chunk of ffmpeg.stdout) {
      for (let offset = 0; offset < chunk.length; ) {
        const taken = Math.min(size - filled, chunk.length - offset);
        chunk.copy(current, filled, offset, offset + taken);
        filled += taken;
        offset += taken;
        if (filled === size) {
          if (count === sorted.length) throw new Error(`More than ${count} frames of ${name}`);
          onFrame(sorted[count++], current);
          current = Buffer.alloc(size);
          filled = 0;
        }
      }
    }
  } catch (error) {
    ffmpeg.kill();
    await settled;
    throw error;
  }
  const [exit, feed] = await settled;
  if (exit.status === 'rejected') throw exit.reason;
  if (exit.value !== 0) throw new Error(`ffmpeg ended with code ${exit.value} decoding ${name}`);
  if (feed.status === 'rejected') throw feed.reason;
  if (count !== sorted.length) {
    throw new Error(`Decoded ${count} of ${sorted.length} frames of ${name}`);
  }
}

/**
 * Decodes frames of an export's parts by index, as `decodeFrames` does an MP4's: only the VP9
 * segments that hold them go to ffmpeg, as an IVF, each from the key frame it starts on.
 */
async function decodePartFrames({plan, partsFolder}, indices, onFrame, pixelFormat = 'rgba') {
  const getStart = frame => frame - (frame % plan.segment);
  const starts = [...new Set(indices.map(getStart))].sort((a, b) => a - b);
  // Every segment but the film's last is whole, and that one, if it is streamed, comes last.
  const frames = new Map(
    indices.map(frame => [
      starts.indexOf(getStart(frame)) * plan.segment + (frame - getStart(frame)),
      frame
    ])
  );
  const blocks = getIvfBlocks(plan, partsFolder, starts);
  await decodeFrames(
    blocks,
    [...frames.keys()],
    plan,
    (place, data) => onFrame(frames.get(place), data),
    pixelFormat
  );
}

/**
 * How far an MP4 is from an export's parts at the frames `indices`, by `getYuvPsnr` on the planes
 * as each is coded: one pass of each, holding only the MP4's frames at those indices.
 */
async function tieParts(moviePath, movie, parts, indices, clock) {
  const frames = new Map();
  const keep = (index, data) => frames.set(index, data);
  await decodeFrames(moviePath, indices, movie, keep, 'yuv420p');
  const psnrs = [];
  await decodePartFrames(
    parts,
    indices,
    (index, data) => {
      psnrs.push({
        frame: index,
        psnr: clock.getYuvPsnr(frames.get(index), data, movie.width, movie.height)
      });
      frames.delete(index);
    },
    'yuv420p'
  );
  return clock.judgeTie(psnrs.sort((a, b) => a.frame - b.frame));
}

/**
 * SSIM of each pair of frames by ffmpeg's `ssim` filter, over each of `regions`, as rows `top` to
 * `bottom`, in one run of it: the pairs go to it as one raw stream, the two frames of each in turn,
 * and it takes them apart again into the two streams it compares.
 */
function getSsims(pairs, frames, {width, height}, regions, folder) {
  const stats = regions.map((_, index) => resolve(folder, `ssim-${index}.txt`));
  const labels = prefix => regions.map((_, index) => `[${prefix}${index}]`).join('');
  const graph = [
    '[0:v]split=2[firsts][seconds]',
    `[firsts]select='not(mod(n,2))',setpts=N,split=${regions.length}${labels('a')}`,
    `[seconds]select='mod(n,2)',setpts=N,split=${regions.length}${labels('b')}`,
    ...regions.map(([top, bottom], index) => {
      const crop = `crop=${width}:${bottom - top}:0:${top}`;
      return (
        `[a${index}]${crop}[c${index}];[b${index}]${crop}[d${index}];` +
        `[c${index}][d${index}]ssim=stats_file='${stats[index]}'[o${index}]`
      );
    })
  ];
  try {
    execFileSync(
      'ffmpeg',
      [
        '-v',
        'error',
        '-f',
        'rawvideo',
        '-pix_fmt',
        'rgba',
        '-s',
        `${width}x${height}`,
        '-i',
        'pipe:0',
        '-filter_complex',
        graph.join(';'),
        ...regions.flatMap((_, index) => ['-map', `[o${index}]`, '-f', 'null', '-'])
      ],
      {input: Buffer.concat(pairs.flatMap(([a, b]) => [frames.get(a), frames.get(b)]))}
    );
    return stats.map(path => {
      const values = readFileSync(path, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map(line => Number(/All:([\d.]+)/.exec(line)?.[1]));
      if (values.length !== pairs.length || values.some(value => !Number.isFinite(value))) {
        throw new Error(`ssim gave ${values.length} values for ${pairs.length} pairs`);
      }
      return values;
    });
  } finally {
    for (const path of stats) rmSync(path, {force: true});
  }
}

/**
 * The MAD and SSIM of each of a group's steps, `[first, second]` by frame, over each of `regions`
 * by name, from frames in hand. A group with `mad: false` has only its SSIM measured, and one with
 * `ssim: false` only its MAD.
 */
function measureSteps(group, frames, {width, height}, regions, folder, getFrameDifference) {
  const ssims =
    group.ssim === false
      ? null
      : getSsims(group.steps, frames, {width, height}, Object.values(regions), folder);
  return Object.fromEntries(
    Object.entries(regions).map(([region, rows], index) => [
      region,
      group.steps.map(([a, b], step) => {
        const measure = {};
        if (group.mad !== false) {
          measure.mad = getFrameDifference(frames.get(a), frames.get(b), width, height, rows).mad;
        }
        if (ssims) measure.ssim = ssims[index][step];
        return measure;
      })
    ])
  );
}

/**
 * The measures of `groups`, each a run of steps, from one pass of `decode`, which hands it each
 * frame it asks for, in order. A group is measured as soon as its frames are in, and a frame is let
 * go once no group still to be measured needs it, so only a few groups' frames are ever held.
 */
async function measureGroups(decode, groups, size, regions, folder, getFrameDifference) {
  // Nothing to decode, as in a run with neither pair: ffmpeg has no empty selection.
  if (groups.length === 0) return [];
  const getFrames = group => new Set(group.steps.flat());
  const needed = new Map();
  for (const group of groups) {
    for (const frame of getFrames(group)) needed.set(frame, (needed.get(frame) ?? 0) + 1);
  }
  const frames = new Map();
  const measures = new Array(groups.length);
  const waiting = new Set(groups.keys());
  await decode([...needed.keys()], (index, data) => {
    frames.set(index, data);
    for (const which of waiting) {
      const group = groups[which];
      if (!group.steps.every(step => step.every(frame => frames.has(frame)))) continue;
      measures[which] = measureSteps(group, frames, size, regions, folder, getFrameDifference);
      waiting.delete(which);
      for (const frame of getFrames(group)) {
        const count = needed.get(frame) - 1;
        needed.set(frame, count);
        if (count === 0) frames.delete(frame);
      }
    }
  });
  if (waiting.size > 0) throw new Error(`${waiting.size} groups of steps were not all decoded`);
  return measures;
}

/**
 * A judgement's MAD and SSIM against their limits. A rule that does not gate it is measured and
 * reported, and says so.
 */
function formatPairRules({mad, ssim, madLeast, madLimit, ssimLimit, madPass, ssimPass, rules}) {
  const judge = (rule, kept) =>
    rules.includes(rule) ? '' : `, ${kept ? 'kept' : 'not kept'}, reported only`;
  return (
    `MAD ${mad.toFixed(3)} (at least ${madLeast.toFixed(3)}, at most ${madLimit.toFixed(3)}` +
    `${judge('mad', madPass)}), ` +
    `SSIM ${ssim.toFixed(4)} (at least ${ssimLimit.toFixed(4)}${judge('ssim', ssimPass)})`
  );
}

/** A spread of SSIM dips, as the loop check reports it. */
function formatDipSpread({median, p90, max}) {
  return `median ${median.toFixed(4)}, 90th percentile ${p90.toFixed(4)}, max ${max.toFixed(4)}`;
}

/**
 * The MP4's wrap's SSIM dip against its limit, beside the dips of the key-frame steps that set it:
 * with the picture, the encoder's share of each, and the MP4's own; or, without them,
 * `unmeasured`, why the SSIM rule's limit stands.
 */
function formatKeyFrameDip({dip, dipLimit, keyFrames, encoderKeyFrames}, margin, unmeasured) {
  let limit = `the SSIM rule's, as ${unmeasured}`;
  if (keyFrames && encoderKeyFrames) {
    limit =
      `the deepest of ${keyFrames.count} key-frame steps', each the MP4's less the picture's ` +
      `there, and ${margin}, and never more than by the MP4's own; less the picture's, their ` +
      `${formatDipSpread(encoderKeyFrames)}; the MP4's own, ${formatDipSpread(keyFrames)}`;
  } else if (keyFrames) {
    limit =
      `the deepest of ${keyFrames.count} key-frame steps' and ${margin}; their ` +
      formatDipSpread(keyFrames);
  }
  return `SSIM dip ${dip.toFixed(4)} (at most ${dipLimit.toFixed(4)}, ${limit})`;
}

/** The two-frame steps across a pair in one region, each against the least its MAD may be. */
function formatTwoFrameSteps(steps, region) {
  return steps
    .map(({frames: [a, b], [region]: judgement}) => {
      const {mad, madLeast} = judgement;
      return `${a} to ${b} MAD ${mad.toFixed(3)} (at least ${madLeast.toFixed(3)})`;
    })
    .join(', ');
}

/** How the loop check ends for each verdict: its last line's word, and the exit code it sets. */
const LOOP_ENDS = {
  pass: {text: 'PASS', exitCode: 0},
  fail: {text: 'FAIL', exitCode: 1},
  encoded: {text: 'encoded only: picture not judged (--parts FOLDER judges it)', exitCode: 2}
};

/**
 * The loop check of any MP4: its wrap and its swap, each against its 16 neighbouring steps, over
 * the whole frame and the band, by `LOOP_CHECK`. The swap keeps the MAD and SSIM rules. The wrap
 * keeps rule 2 on the MP4, the MAD rule and an SSIM dip below its neighbours' median no deeper than
 * the deepest at the file's own internal key-frame steps, from the stream, plus `keyFrameMargin`.
 * The two-frame steps across each keep their rule, on the MP4.
 *
 * With `parts`, an export's parts folder and its plan, the MP4 must be of their plan and an encode
 * of their VP9, by `getTieFrames` and `judgeTie`, or it stops with an error. Then the wrap keeps
 * rule 1 too, the MAD and SSIM rules on its picture, decoded from their VP9; the two-frame steps
 * are judged on that picture instead; and each key-frame step's dip in rule 2 is the MP4's less the
 * picture's there. Without them, its verdict is at best `encoded`, the picture not judged.
 *
 * A cycle file of the wrong length fails before its pairs are measured. `from` is the story second
 * its first frame shows: as given, else what an export wrote in its comment, else
 * `LOOP.fileStart`. Its report goes to `folder`, which is made.
 */
async function checkLoop(moviePath, given, clock, folder, parts = null) {
  const {LOOP, LOOP_CHECK, CYCLE_SECONDS, getCycleSeconds, getFrameDifference, getSsimDip} = clock;
  const movie = probeMovie(moviePath);
  const commented = movie.comment.includes(COMMENT_MARK);
  const written = commented ? Number(/from=(-?[\d.]+)/.exec(movie.comment)?.[1]) : Number.NaN;
  const fromGiven = Number.isFinite(given.from);
  const from = fromGiven ? given.from : Number.isFinite(written) ? written : LOOP.fileStart;
  const {frames, width, height} = movie;
  const fps = given.fps ?? movie.fps;
  if (parts) {
    const differ = Object.entries({width, height, frames, fps, from}).filter(
      ([name, value]) => !(Math.abs(parts.plan[name] - value) <= 1e-9)
    );
    if (differ.length > 0) {
      throw new Error(
        `The parts in ${parts.partsFolder} are not of this MP4: ` +
          differ.map(([name, value]) => `${name} ${parts.plan[name]}, not ${value}`).join(', ')
      );
    }
  }
  const cycleFile = clock.isCycleFile({
    commented,
    cycle: commented && /(^|\s)cycle=1(\s|$)/.test(movie.comment),
    fromGiven
  });
  const frameCount = clock.judgeFrameCount(frames, fps, cycleFile);
  const pairs = clock.getLoopPairs(from, frames, fps);
  const band = LOOP_CHECK.band.map(share => Math.round(share * height));
  const regions = {whole: [0, height], band};
  const {keyFrames, firstTime} = readFrameTimes(moviePath);
  // The steps into the file's key frames but the wrap's own, or null if the wrap is not one.
  const keyFrameSteps = clock.getKeyFrameSteps(keyFrames, frames, pairs.cycle, pairs.wrap);
  const report = {
    file: moviePath,
    width,
    height,
    frames,
    fps,
    from,
    cycleFile,
    frameCount,
    cycle: pairs.cycle,
    keyFrames: {
      count: keyFrames.length,
      everyGop: keyFrames.every((frame, index) => frame === index * GOP_FRAMES),
      first: keyFrames.slice(0, 4)
    },
    firstTime,
    editList: hasEditList(moviePath),
    band,
    parts: parts?.partsFolder ?? null,
    tie: null,
    pairs: []
  };
  mkdirSync(folder, {recursive: true});
  const finish = verdict => {
    report.verdict = verdict;
    report.pass = verdict === 'pass';
    console.log(
      `LOOP ${frames} frames at ${fps} fps from ${from} s, key frames ${report.keyFrames.count}` +
        `${report.keyFrames.everyGop ? ` every ${GOP_FRAMES}` : ' not every GOP'}, ` +
        `${report.editList ? 'an edit list' : 'no edit list'}, ` +
        `the first frame at ${firstTime.toFixed(6)} s: ${LOOP_ENDS[verdict].text}`
    );
    writeFileSync(resolve(folder, 'loop.json'), `${JSON.stringify(report, null, 2)}\n`);
    return report;
  };
  if (!frameCount.pass) {
    console.log(
      `LOOP ${frames} frames, where a cycle file has exactly ${frameCount.cycleFrames}, ` +
        `${CYCLE_SECONDS} s at ${fps} fps: its last frame does not run on into its first, ` +
        'and its wrap is not judged, FAIL'
    );
    return finish('fail');
  }
  if (parts) {
    const tie = await tieParts(moviePath, movie, parts, clock.getTieFrames(frames, pairs), clock);
    report.tie = tie;
    console.log(
      'LOOP the MP4 against the parts, Y, U and V at frames ' +
        `${tie.frames.map(({frame}) => frame).join(', ')}: PSNR ` +
        `${tie.frames.map(({psnr}) => psnr.toFixed(2)).join(', ')} dB, the least ` +
        `${tie.least.toFixed(2)} at frame ${tie.leastFrame} ` +
        `(at least ${LOOP_CHECK.leastPartsPsnr}), ${tie.pass ? 'tied' : 'NOT tied'}`
    );
    if (!tie.pass) {
      throw new Error(
        `The parts in ${parts.partsFolder} are not this file's: its frame ${tie.leastFrame} is ` +
          `${tie.least.toFixed(2)} dB from theirs, where an encode of them is at least ` +
          `${LOOP_CHECK.leastPartsPsnr} dB`
      );
    }
  }
  const next = (frame, span = 1) => (frame + span) % frames;
  // A step and its neighbours, each from its first frame to the frame `span` on.
  const getSteps = (pair, span = 1) => {
    const firsts = [
      pair,
      ...clock.getNeighbourPairs(pair, frames, pairs.cycle, LOOP_CHECK.neighbours, span)
    ];
    return firsts.map(first => [first, next(first, span)]);
  };
  // The two-frame steps across a pair, each with its neighbours, are of MAD alone.
  const getTwoFrameGroups = pair =>
    clock
      .getTwoFrameSteps(pair, frames, pairs.cycle)
      .map(first => ({steps: getSteps(first, 2), ssim: false}));
  const getPairGroup = pair =>
    pair === null ? null : {steps: getSteps(pair), twoFrame: getTwoFrameGroups(pair)};
  const wrap = getPairGroup(pairs.wrap);
  const swap = getPairGroup(pairs.swap);
  const twoFrameGroups = [wrap, swap].flatMap(group => group?.twoFrame ?? []);
  // The key-frame steps' dips are of SSIM alone.
  const keys = (keyFrameSteps ?? []).map(step => ({steps: getSteps(step), mad: false}));
  const measureAll = async (decode, groups) => {
    const measured = await measureGroups(
      decode,
      groups,
      movie,
      regions,
      folder,
      getFrameDifference
    );
    return new Map(groups.map((group, index) => [group, measured[index]]));
  };
  // The MP4's pairs and key-frame steps, and its two-frame steps when there is no picture.
  const measures = await measureAll(
    (indices, onFrame) => decodeFrames(moviePath, indices, movie, onFrame),
    [wrap, swap, ...keys, ...(parts ? [] : twoFrameGroups)].filter(Boolean)
  );
  // The picture's wrap, two-frame steps and key-frame steps, from the parts' VP9.
  const pictureMeasures = parts
    ? await measureAll(
        (indices, onFrame) => decodePartFrames(parts, indices, onFrame),
        [wrap, ...twoFrameGroups, ...keys].filter(Boolean)
      )
    : null;
  const twoFrameSource = pictureMeasures ? 'picture from the parts' : 'MP4';
  // Each region's judgement of a group, whose measures are of its pair, then its neighbours.
  const judgeRegions = (values, judge) =>
    Object.fromEntries(
      Object.keys(regions).map(region => {
        const [pair, ...neighbours] = values[region];
        return [region, {...judge(pair, neighbours, region), neighbours}];
      })
    );
  const judgeTwoFrame = group => ({
    frames: group.steps[0],
    ...judgeRegions((pictureMeasures ?? measures).get(group), (step, neighbours) =>
      clock.judgeTwoFrameStep(step, neighbours)
    )
  });
  const describe = ([a, b]) => {
    const seconds = [a, b].map(frame => clock.getFrameSeconds(from, frame, fps));
    const text = `${a} to ${b} (${seconds.map(value => value.toFixed(3)).join(' to ')} s)`;
    return {frames: [a, b], seconds, text};
  };
  const passText = judgement => (judgement.pass ? 'pass' : 'FAIL');
  const logTwoFrame = (name, pair, twoFrame) => {
    for (const region of Object.keys(regions)) {
      const kept = twoFrame.every(step => step[region].pass);
      console.log(
        `LOOP ${name} ${pair.text}, two-frame steps, ${twoFrameSource}, ${region}: ` +
          `${formatTwoFrameSteps(twoFrame, region)}, ${kept ? 'pass' : 'FAIL'}`
      );
    }
  };

  if (wrap) {
    const pair = describe(wrap.steps[0]);
    // Each key-frame step's dip below its neighbours, in the MP4, and with the parts in the
    // picture too and the encoder's share, the MP4's less the picture's.
    const getDip = (values, region) => {
      const [step, ...neighbours] = values[region];
      return {ssim: step.ssim, dip: getSsimDip(step, neighbours)};
    };
    const steps = keys.map(group => {
      const dips = Object.keys(regions).map(region => {
        const encoded = getDip(measures.get(group), region);
        if (!pictureMeasures) return [region, encoded];
        const picture = getDip(pictureMeasures.get(group), region);
        return [region, {...encoded, picture, encoderDip: encoded.dip - picture.dip}];
      });
      return {frames: group.steps[0], ...Object.fromEntries(dips)};
    });
    const encoded = judgeRegions(measures.get(wrap), (step, neighbours, region) =>
      clock.judgeEncodedWrap(
        step,
        neighbours,
        keyFrameSteps && steps.map(keyFrameStep => keyFrameStep[region].dip),
        keyFrameSteps && pictureMeasures
          ? steps.map(keyFrameStep => keyFrameStep[region].picture.dip)
          : null
      )
    );
    const picture = pictureMeasures
      ? {
          source: parts.partsFolder,
          ...judgeRegions(pictureMeasures.get(wrap), (step, neighbours) =>
            clock.judgeLoopPair(step, neighbours, LOOP_CHECK.rules.wrapPicture)
          )
        }
      : null;
    const twoFrame = wrap.twoFrame.map(judgeTwoFrame);
    const verdict = clock.judgeWrap(encoded, picture, twoFrame);
    report.pairs.push({
      name: 'wrap',
      frames: pair.frames,
      seconds: pair.seconds,
      ...verdict,
      picture,
      whole: encoded.whole,
      band: encoded.band,
      twoFrame: {source: twoFrameSource, steps: twoFrame},
      keyFrameSteps: steps
    });
    if (picture) {
      for (const region of Object.keys(regions)) {
        console.log(
          `LOOP wrap ${pair.text}, picture from the parts, ${region}: ` +
            `${formatPairRules(picture[region])}, ${passText(picture[region])}`
        );
      }
    } else {
      console.log(`LOOP wrap ${pair.text}, picture: not judged, no parts at hand (--parts FOLDER)`);
    }
    const unmeasured =
      keyFrameSteps === null ? 'the wrap is not a step into a key frame' : 'no other key frame';
    for (const region of Object.keys(regions)) {
      const judgement = encoded[region];
      console.log(
        `LOOP wrap ${pair.text}, MP4, ${region}: ${formatPairRules(judgement)}, ` +
          `${formatKeyFrameDip(judgement, LOOP_CHECK.keyFrameMargin, unmeasured)}, ` +
          passText(judgement)
      );
    }
    logTwoFrame('wrap', pair, twoFrame);
  }
  if (swap) {
    const pair = describe(swap.steps[0]);
    const judged = judgeRegions(measures.get(swap), (step, neighbours) =>
      clock.judgeLoopPair(step, neighbours, LOOP_CHECK.rules.swap)
    );
    const twoFrame = swap.twoFrame.map(judgeTwoFrame);
    report.pairs.push({
      name: 'swap',
      frames: pair.frames,
      seconds: pair.seconds,
      ...clock.judgeSwap(judged, twoFrame),
      ...judged,
      twoFrame: {source: twoFrameSource, steps: twoFrame}
    });
    for (const region of Object.keys(regions)) {
      console.log(
        `LOOP swap ${pair.text}, ${region}: ${formatPairRules(judged[region])}, ` +
          passText(judged[region])
      );
    }
    logTwoFrame('swap', pair, twoFrame);
  }
  if (report.pairs.length === 0) {
    console.log(`LOOP no wrap and no swap in ${frames} frames from ${getCycleSeconds(from)} s`);
  }
  return finish(
    clock.getLoopVerdict(
      report.pairs.map(pair => pair.pass),
      pictureMeasures !== null
    )
  );
}

/**
 * Whether an export of one cycle has the file's shape: every frame, closed GOPs, no edit list, and
 * the first frame showing at 0.
 */
function isCycleShaped(report, plan) {
  return (
    report.frames === plan.frames &&
    report.keyFrames.everyGop &&
    !report.editList &&
    report.firstTime === 0 &&
    report.cycle
  );
}

async function runExport(options, clock) {
  if (!options.out) throw new Error('--out is required');
  const plan = getPlan(options, clock);
  const h264 = getH264Options(options);
  const gates = plan.cycle && options.gates !== '0';
  const checksLoop = gates || options['check-loop'] === '1';
  const checksSeam = gates && options['check-seam'] !== '0';
  const moviePath = resolve(options.out);
  const partsFolder = `${moviePath}.parts`;
  if (existsSync(moviePath) && !options.overwrite) {
    throw new Error(`${moviePath} is already there. Pass --overwrite 1 to replace it.`);
  }
  if (!existsSync(VERIFY_SCRIPT)) throw new Error(`No verifier at ${VERIFY_SCRIPT}`);

  mkdirSync(partsFolder, {recursive: true});
  const planPath = resolve(partsFolder, 'plan.json');
  const planText = JSON.stringify(plan, null, 2);
  if (existsSync(planPath) && readFileSync(planPath, 'utf8') !== planText) {
    throw new Error(`${partsFolder} holds parts of a different export. Remove it to start again.`);
  }
  writeFileSync(planPath, planText);

  const fingerprintPath = resolve(partsFolder, 'sources.json');
  const fingerprints = existsSync(fingerprintPath)
    ? JSON.parse(readFileSync(fingerprintPath, 'utf8'))
    : [];
  const fingerprint = getSourceFingerprint();
  if (fingerprints.length > 0 && !fingerprints.includes(fingerprint)) {
    console.warn("WARNING the film's sources changed since these parts were made.");
  }
  if (!fingerprints.includes(fingerprint)) fingerprints.push(fingerprint);
  writeFileSync(fingerprintPath, JSON.stringify(fingerprints));

  const started = Date.now();
  console.log(
    `EXPORT ${plan.width}x${plan.height} ${plan.fps} fps, ${plan.frames} frames from ` +
      `${plan.from} s${plan.cycle ? ', one cycle from the file start' : ''}, ${plan.samples} ` +
      `samples per frame -> ${basename(moviePath)}`
  );
  if (checksSeam) {
    // Before a frame is rendered, so a swap that shows fails in minutes, not after the whole film.
    const seamPath = resolve(partsFolder, 'seam.json');
    const passed = existsSync(seamPath) && JSON.parse(readFileSync(seamPath, 'utf8'));
    if (passed?.pass && passed.fingerprint === fingerprint) {
      console.log('SEAM passed already for these sources');
    } else {
      const report = await checkSeam(plan, clock, partsFolder);
      writeFileSync(seamPath, `${JSON.stringify({...report, fingerprint}, null, 2)}\n`);
      if (!report.pass) throw new Error(`The seam check failed. See ${seamPath}`);
    }
  }
  await renderSegments(plan, partsFolder, resolve(partsFolder, 'progress.json'), clock);

  const encodingPath = resolve(partsFolder, 'encoding.mp4');
  const reportPath = resolve(partsFolder, 'verify.json');
  await transcode(plan, partsFolder, encodingPath, h264);
  const report = verify(encodingPath, plan, reportPath);
  if (report.status !== 'PASS') {
    throw new Error(
      `Verification: ${JSON.stringify(report)}\nThe frames stay in ${partsFolder}: the same ` +
        'command encodes them again without rendering any.'
    );
  }
  if (checksLoop) {
    const given = {from: plan.from, fps: plan.fps};
    // The parts are at hand, so the wrap's picture is judged from them as well as the MP4.
    const loop = await checkLoop(encodingPath, given, clock, partsFolder, {plan, partsFolder});
    if (!loop.pass) throw new Error(`The loop check failed. See ${partsFolder}/loop.json`);
    if (plan.cycle && !isCycleShaped(loop, plan)) {
      throw new Error(
        `Not one cycle of closed GOPs from 0 s without an edit list. See ${partsFolder}`
      );
    }
  }
  renameSync(encodingPath, moviePath);
  const {size} = statSync(moviePath);
  const {status, checks, observed} = report;
  console.log(`VERIFIED ${JSON.stringify({status, checks, observed})}`);
  console.log(
    `PASS ${moviePath}, ${(size / 1e6).toFixed(1)} MB, ` +
      formatDuration((Date.now() - started) / 1000) +
      (fingerprints.length > 1 ? `, from ${fingerprints.length} versions of the sources` : '')
  );
  if (!options['keep-parts']) rmSync(partsFolder, {recursive: true});
}

/**
 * A folder for a check's files: `--keep`, or a hidden one beside the MP4 it checks, which goes
 * once the check is done.
 */
function getCheckFolder(options, moviePath) {
  if (options.keep) {
    const folder = resolve(options.keep);
    mkdirSync(folder, {recursive: true});
    return {folder, done: () => {}};
  }
  const folder = mkdtempSync(resolve(dirname(moviePath), `.${basename(moviePath)}.loop-`));
  return {folder, done: () => rmSync(folder, {recursive: true, force: true})};
}

/**
 * An export's parts folder, as `--parts` names it for `--check-loop FILE`, and the plan it was made
 * to, which the loop check holds the MP4 to before it judges the wrap's picture from their VP9.
 */
function readParts(folder) {
  const partsFolder = resolve(folder);
  const planPath = resolve(partsFolder, 'plan.json');
  if (!existsSync(planPath)) throw new Error(`No export's parts in ${partsFolder}: no plan.json`);
  return {plan: JSON.parse(readFileSync(planPath, 'utf8')), partsFolder};
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const clock = await loadStoryClock();
  const loopFile = options['check-loop'];
  const checksFile = !options.out && loopFile !== undefined && loopFile !== '0' && loopFile !== '1';
  if (options.parts !== undefined && !checksFile) {
    throw new Error('--parts goes with --check-loop FILE alone: an export judges its own parts');
  }
  if (checksFile) {
    const moviePath = resolve(loopFile);
    if (!existsSync(moviePath)) throw new Error(`No MP4 at ${moviePath}`);
    const parts = options.parts === undefined ? null : readParts(options.parts);
    const {folder, done} = getCheckFolder(options, moviePath);
    try {
      const given = {
        from: options.from === undefined ? Number.NaN : Number(options.from),
        fps: options.fps === undefined ? undefined : Number(options.fps)
      };
      const report = await checkLoop(moviePath, given, clock, folder, parts);
      process.exitCode = LOOP_ENDS[report.verdict].exitCode;
    } finally {
      done();
    }
    return;
  }
  if (!options.out && isOn(options['check-seam'])) {
    const plan = getPlan({...options, cycle: undefined, from: undefined, to: undefined}, clock);
    const folder = options.keep ? resolve(options.keep) : null;
    if (folder) mkdirSync(folder, {recursive: true});
    const report = await checkSeam(plan, clock, folder);
    if (!report.pass) process.exitCode = 1;
    return;
  }
  await runExport(options, clock);
}

main().catch(error => {
  console.error(`${error.stack ?? error}`);
  process.exitCode = 1;
});
