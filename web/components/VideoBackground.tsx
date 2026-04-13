"use client";

import { useEffect, useRef, memo } from "react";

interface VideoBackgroundProps {
  src: string;
  className?: string;
}

function VideoBackgroundInner({ src, className = "" }: VideoBackgroundProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<import("hls.js").default | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    // If the browser can play HLS natively (Safari), just set the src
    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = src;
      video.play().catch(() => {});
      return;
    }

    // Otherwise use hls.js
    let destroyed = false;

    import("hls.js").then(({ default: Hls }) => {
      if (destroyed || !Hls.isSupported()) return;

      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
      });

      hlsRef.current = hls;
      hls.loadSource(src);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        video.play().catch(() => {});
      });
    });

    return () => {
      destroyed = true;
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [src]);

  return (
    <video
      ref={videoRef}
      autoPlay
      loop
      muted
      playsInline
      className={className}
      style={{ objectFit: "cover" }}
    />
  );
}

const VideoBackground = memo(VideoBackgroundInner);
VideoBackground.displayName = "VideoBackground";

export default VideoBackground;
