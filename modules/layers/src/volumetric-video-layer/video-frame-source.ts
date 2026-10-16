// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {
  BlobSource,
  EncodedPacketSink,
  Input,
  MP4,
  QTFF,
  UrlSource,
  VideoSampleSink
} from 'mediabunny';

/** Metadata for the selected video track, in presentation order. */
export type VolumetricVideoInfo = {
  /** Display width after pixel aspect ratio and rotation correction. */
  width: number;
  /** Display height after pixel aspect ratio and rotation correction. */
  height: number;
  /** Number of presentable frames (excludes negative-timestamp preroll). */
  frameCount: number;
  /** End of the video track in seconds. */
  duration: number;
  /** Actual source presentation timestamps, in seconds, indexed by currentFrame. */
  frameTimestamps: readonly number[];
};

/** Owns demuxing and decoding; never retains decoded frames after an upload. */
export class VideoFrameSource {
  readonly input: Input;
  info?: VolumetricVideoInfo;
  sink?: VideoSampleSink;
  destroyed = false;

  constructor(video: string | Blob) {
    // Use the maintained ISO BMFF and QuickTime demuxers.
    this.input = new Input({
      formats: [MP4, QTFF],
      source: typeof video === 'string' ? new UrlSource(video) : new BlobSource(video)
    });
  }

  async initialize(): Promise<VolumetricVideoInfo> {
    const track = await this.input.getPrimaryVideoTrack();
    if (!track) {
      throw new Error('The file does not contain a video track.');
    }
    if (!(await track.canDecode())) {
      throw new Error(
        `This browser cannot decode the video's ${await track.getCodec()} codec. Try an H.264 MP4 or MOV.`
      );
    }
    const timestamps: number[] = [];
    const packets = new EncodedPacketSink(track);
    for await (const packet of packets.packets(undefined, undefined, {metadataOnly: true})) {
      if (this.destroyed) {
        throw new Error('Video source was disposed.');
      }
      if (packet.timestamp >= 0) {
        timestamps.push(packet.timestamp);
      }
    }
    // Encoded packets arrive in decode order, which can differ for B-frames.
    timestamps.sort((a, b) => a - b);
    if (!timestamps.length) {
      throw new Error('The video does not contain any presentable frames.');
    }
    const [width, height, duration] = await Promise.all([
      track.getDisplayWidth(),
      track.getDisplayHeight(),
      track.computeDuration()
    ]);
    this.sink = new VideoSampleSink(track);
    this.info = {
      width,
      height,
      duration,
      frameCount: timestamps.length,
      frameTimestamps: timestamps
    };
    return this.info;
  }

  destroy(): void {
    if (!this.destroyed) {
      this.destroyed = true;
      this.input.dispose();
    }
  }
}
