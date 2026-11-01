// Video for the runner's pages, decoded by ffmpeg when it is installed:
// media elements that load, play and report their size, and their current
// frame as RGBA8 for uploads. Without ffmpeg, media elements fail to load,
// and pages skip their video cases.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Whether ffmpeg and ffprobe can be run. */
export const ffmpegAvailable = (() => {
  try {
    execFileSync('ffprobe', ['-version'], { stdio: 'ignore' });
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

let directory;

/** Writes video bytes to a temporary file for ffmpeg, removed at exit. */
export function videoFile(bytes) {
  if (directory === undefined) {
    const made = mkdtempSync(join(tmpdir(), 'oxgl-video-'));
    directory = made;
    process.on('exit', () => rmSync(made, { recursive: true, force: true }));
  }
  const file = join(directory, `${String(Date.now())}-${Math.random().toString(36).slice(2)}`);
  writeFileSync(file, bytes);
  return file;
}

/**
 * The displayed size and duration of a video file, rotation applied as
 * browsers apply it, or `undefined` when it has no decodable video stream.
 */
export function probe(file) {
  let info;
  try {
    info = JSON.parse(
      execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name,width,height,duration:stream_side_data=rotation:format=duration', '-of', 'json', file], {
        encoding: 'utf8',
      }),
    );
  } catch {
    return undefined;
  }
  const stream = info.streams?.[0];
  if (!(stream?.width > 0 && stream?.height > 0)) return undefined;
  const rotation = Number(stream.side_data_list?.find((d) => 'rotation' in d)?.rotation ?? 0);
  const quarter = Math.abs(rotation) % 180 === 90;
  const duration = Number(stream.duration ?? info.format?.duration);
  return {
    // ffmpeg's own VP8 and VP9 decoders drop a WebM's alpha; libvpx keeps it.
    decoder: { vp8: 'libvpx', vp9: 'libvpx-vp9' }[stream.codec_name],
    width: quarter ? stream.height : stream.width,
    height: quarter ? stream.width : stream.height,
    duration: Number.isFinite(duration) && duration > 0 ? duration : 1,
  };
}

/**
 * The frame shown at `time` seconds of a video `probe` described, as RGBA8
 * top row first, rotation applied.
 */
export function frameAt(file, time, { width, height, decoder }) {
  const codec = decoder === undefined ? [] : ['-c:v', decoder];
  // Bit-exact YUV to RGB conversion: swscale's default SIMD paths round
  // differently on x86 and Arm, so frames would differ by host.
  const scale = ['-sws_flags', 'accurate_rnd+bitexact+full_chroma_int'];
  const run = (seek) =>
    execFileSync('ffmpeg', ['-v', 'error', '-ss', String(seek), ...codec, '-i', file, '-frames:v', '1', ...scale, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], {
      maxBuffer: width * height * 4 + 1024,
    });
  let bytes = run(time);
  // Seeking past the last frame yields nothing; the first frame then.
  if (bytes.length < width * height * 4) bytes = run(0);
  return { data: new Uint8ClampedArray(bytes.buffer, bytes.byteOffset, width * height * 4), width, height };
}
