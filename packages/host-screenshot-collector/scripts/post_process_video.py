#!/usr/bin/env python3
"""
Post-process screen recording video.

This script processes raw.mp4 into a final workflow video with:
1. Cursor overlay animation based on click events
2. Trimming of inactive sections
3. Speed-up of transitions
4. GIF preview generation for GitHub comments

Usage:
    python3 post_process_video.py <output_dir>

Input files (in output_dir):
    - raw.mp4: The raw screen recording
    - events.log: JSON-lines file with click events
    - video-metadata.json: Optional metadata with fileName and description

Output files (in output_dir):
    - workflow.mp4: Processed video (or custom name from metadata)
    - workflow.gif: Animated GIF preview for GitHub (or custom name)
"""

import subprocess
import os
import sys
import json

# Convex storage has 20MB limit for files
CONVEX_SIZE_LIMIT_MB = 20

# Pre-rendered cursor PNG as base64 (32x32 macOS-style pointer)
CURSOR_B64 = "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAABX0lEQVR4nO2U4XGCQBCF31ag6eBSQehA7CAdZKlASzg6oANJCalA6EArQCsIHZB3msQxAsJBxj98Mzs7DOy8j72ZEzyYSWASmAQmgUlgEhgkUFVVCOAgIgd4MlTgk82xFJEde2+GClRRFGGz2ZR8XIqHxGABhkJVvSVGEXCop8R52hPm/wo41EPiMu0B868EHNpT4nq6J8y/EXBoD4nb6R4wv1bAoR0l6qc7wvxGAYdeJJ5FxPUbmqc7wPxWAcd2u0UYhksRyVBD+/QdmF8rUBQFjDH4Zs8K+d3/boCrRpqmyPMcq9UKSZK8i4jiDudpT5hfrtfrmTvrIAj2FHiJeDXP5/PTFtifKFH75z8MFQjYLIAdK2EdjDGz4/F42oiqxiJi0cIggb9QKLXWvsVxjMVigSzLchEJ0cLYAqYsy4J/7o4E1toPCrzyVSOjCjgooeAVAKBkKQVcb2R0gb58AQH2qSGP9lZkAAAAAElFTkSuQmCC"


def log(msg):
    """Print to stderr for logging."""
    print(msg, file=sys.stderr)


def parse_events_log(events_log_path):
    """Parse events.log for click events and recording start time."""
    clicks = []  # list of (timestamp_ms, x, y)
    recording_start_ms = None

    log(f"Reading events from {events_log_path}")

    line_count = 0
    try:
        with open(events_log_path) as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                line_count += 1
                event = json.loads(line)
                ts = event.get("timestamp", 0)
                event_type = event.get("event", "")

                # Detect recording start
                if event_type == "recording_start":
                    if recording_start_ms is None:
                        recording_start_ms = ts
                        log(f"Found recording start at {ts}")

                # Click event - has screen coordinates directly
                elif event_type == "click":
                    x = event.get("x", 0)
                    y = event.get("y", 0)
                    clicks.append((ts, x, y))
                    log(f"click at ({x}, {y}) ts={ts}")

        log(f"Processed {line_count} events")
    except FileNotFoundError:
        log(f"ERROR: events.log not found: {events_log_path}")
    except Exception as e:
        log(f"ERROR reading events.log: {e}")

    log(f"Found {len(clicks)} clicks")
    return clicks, recording_start_ms


def validate_raw_video(raw_path, outdir):
    """Validate raw.mp4 and attempt recovery if needed. Returns True if valid."""
    if not os.path.exists(raw_path):
        log(f"ERROR: raw.mp4 not found at {raw_path}")
        return False

    raw_size = os.path.getsize(raw_path)
    log(f"raw.mp4 size: {raw_size} bytes")
    if raw_size < 1000:
        log(f"ERROR: raw.mp4 is too small ({raw_size} bytes) - likely corrupted")
        return False

    # Validate raw.mp4 with ffprobe
    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0",
         "-show_entries", "stream=codec_name,width,height,duration",
         "-of", "csv=p=0", raw_path],
        capture_output=True, text=True
    )

    if probe.returncode != 0:
        log("ERROR: raw.mp4 failed ffprobe validation")
        log(f"ffprobe stderr: {probe.stderr}")

        # Check if it's a moov atom issue (common with fragmented MP4)
        is_moov_issue = "moov" in probe.stderr.lower() or "Invalid data" in probe.stderr

        if is_moov_issue:
            log("Detected moov atom issue - attempting recovery with re-encoding...")
            salvage = subprocess.run([
                "ffmpeg", "-y", "-fflags", "+genpts+igndts",
                "-i", raw_path,
                "-c:v", "libx264", "-preset", "ultrafast", "-crf", "26",
                "-movflags", "+faststart",
                f"{outdir}/workflow.mp4"
            ], capture_output=True, text=True)
        else:
            log("Attempting to salvage with ffmpeg copy...")
            salvage = subprocess.run(
                f'ffmpeg -y -i "{raw_path}" -c copy -movflags +faststart "{outdir}/workflow.mp4"',
                shell=True, capture_output=True, text=True
            )

        if salvage.returncode == 0:
            verify = subprocess.run(
                ["ffprobe", "-v", "error", f"{outdir}/workflow.mp4"],
                capture_output=True, text=True
            )
            if verify.returncode == 0:
                log("Salvage successful and verified")
                os.remove(raw_path)
                return False  # Already created workflow.mp4
            else:
                log(f"Salvaged file failed verification: {verify.stderr}")
                os.rename(raw_path, f"{outdir}/workflow.mp4")
        else:
            log(f"Salvage failed: {salvage.stderr}")
            os.rename(raw_path, f"{outdir}/workflow.mp4")
        return False  # Already handled

    log(f"raw.mp4 stream info: {probe.stdout.strip()}")
    return True


def create_cursor_png(cursor_path):
    """Create cursor PNG file from embedded base64 data."""
    import base64
    try:
        cursor_data = base64.b64decode(CURSOR_B64)
        with open(cursor_path, 'wb') as f:
            f.write(cursor_data)
        log(f"Created cursor PNG at {cursor_path}")
        return True
    except Exception as e:
        log(f"Failed to create cursor PNG: {e}")
        return False


def add_cursor_overlay_png(outdir, clicks):
    """Add cursor overlay using PNG image. Returns True on success."""
    cursor_path = f"{outdir}/cursor.png"
    if not create_cursor_png(cursor_path):
        return False

    # Screen center and cursor tip offset
    cx, cy = 960, 540
    tip_offset = 4  # cursor tip offset within 32x32 image

    first_t, first_x, first_y = clicks[0]
    anim_dur = max(first_t, 0.1)

    log(f"Animation: center ({cx},{cy}) -> ({first_x},{first_y}) over {anim_dur:.2f}s")

    # Animation expressions for smooth movement
    anim_x_expr = f"({cx}-{tip_offset}+({first_x}-{cx})*min(t/{anim_dur},1))"
    anim_y_expr = f"({cy}-{tip_offset}+({first_y}-{cy})*min(t/{anim_dur},1))"

    # Build overlay filters
    overlay_parts = []
    overlay_parts.append(f"overlay=x='{anim_x_expr}':y='{anim_y_expr}':enable='between(t,0,{anim_dur:.2f})'")

    for i, (t, x, y) in enumerate(clicks):
        end_t = clicks[i+1][0] if i+1 < len(clicks) else 9999
        if end_t <= t:
            continue
        overlay_parts.append(f"overlay=x={x-tip_offset}:y={y-tip_offset}:enable='between(t,{t:.2f},{end_t:.2f})'")

    # Build filter chain
    filter_chain = f"[0:v][1:v]{overlay_parts[0]}[v0]"
    for i, overlay in enumerate(overlay_parts[1:], 1):
        filter_chain += f";[v{i-1}][1:v]{overlay}[v{i}]"
    last_idx = len(overlay_parts) - 1

    log(f"Drawing cursor overlay with {len(overlay_parts)} overlay filters")
    result = subprocess.run([
        "ffmpeg", "-y",
        "-i", f"{outdir}/raw.mp4",
        "-i", cursor_path,
        "-filter_complex", filter_chain,
        "-map", f"[v{last_idx}]",
        "-movflags", "+faststart",
        f"{outdir}/with_cursor.mp4"
    ], capture_output=True, text=True)

    if result.returncode != 0:
        log(f"Cursor overlay failed: {result.stderr}")
        return False

    return True


def add_cursor_overlay_drawtext(outdir, clicks):
    """Fallback: Add cursor using drawtext. Returns True on success."""
    cursor_char = "⮝"
    shadow_offset = 2
    cursor_size = 28
    cx, cy = 960, 540
    tip_offset_x, tip_offset_y = -4, -2

    first_t, first_x, first_y = clicks[0]
    anim_dur = max(first_t, 0.1)

    # Animation expressions
    anim_x = f"({cx}+{tip_offset_x}+({first_x}-{cx})*min(t/{anim_dur},1))"
    anim_y = f"({cy}+{tip_offset_y}+({first_y}-{cy})*min(t/{anim_dur},1))"
    shadow_x = f"({cx}+{tip_offset_x}+{shadow_offset}+({first_x}-{cx})*min(t/{anim_dur},1))"
    shadow_y = f"({cy}+{tip_offset_y}+{shadow_offset}+({first_y}-{cy})*min(t/{anim_dur},1))"

    # Build drawtext filter
    drawtext_parts = [
        f"drawtext=text='{cursor_char}':x='{shadow_x}':y='{shadow_y}':fontsize={cursor_size}:fontcolor=black@0.6:enable='between(t,0,{anim_dur:.2f})'",
        f"drawtext=text='{cursor_char}':x='{anim_x}':y='{anim_y}':fontsize={cursor_size}:fontcolor=white:enable='between(t,0,{anim_dur:.2f})'"
    ]

    for i, (t, x, y) in enumerate(clicks):
        end_t = clicks[i+1][0] if i+1 < len(clicks) else 9999
        if end_t <= t:
            continue
        drawtext_parts.append(
            f"drawtext=text='{cursor_char}':x={x+tip_offset_x+shadow_offset}:y={y+tip_offset_y+shadow_offset}:fontsize={cursor_size}:fontcolor=black@0.6:enable='between(t,{t:.2f},{end_t:.2f})'"
        )
        drawtext_parts.append(
            f"drawtext=text='{cursor_char}':x={x+tip_offset_x}:y={y+tip_offset_y}:fontsize={cursor_size}:fontcolor=white:enable='between(t,{t:.2f},{end_t:.2f})'"
        )

    vf = ",".join(drawtext_parts)
    result = subprocess.run(
        f'ffmpeg -y -i "{outdir}/raw.mp4" -vf "{vf}" -movflags +faststart "{outdir}/with_cursor.mp4"',
        shell=True, capture_output=True, text=True
    )

    if result.returncode != 0:
        log(f"Drawtext cursor failed: {result.stderr}")
        return False

    return True


def trim_and_speedup(outdir, clicks, video_duration):
    """Trim inactive sections and speed up transitions."""
    # Trimming parameters (less aggressive to allow content to load)
    FAST_SPEED = 8  # Speed for transition segments (was 10)
    ACTION_BEFORE = 0.45  # seconds before click at normal speed (1.5x)
    ACTION_AFTER = 3.0  # seconds after click at normal speed (1.5x)
    LAST_ACTION_AFTER = 4.5  # extra time for last click (1.5x)
    MAX_TRANSITION = 0.45  # max seconds to keep from gaps before speedup (1.5x)
    END_OF_VIDEO_BUFFER = 2.25  # seconds to keep at end (1.5x)

    # Build segments
    video_segments = []  # (start, end, speed)
    prev_action_end = 0.0
    num_clicks = len(clicks)

    for i, (t, x, y) in enumerate(clicks):
        is_last_click = (i == num_clicks - 1)
        action_start = max(0, t - ACTION_BEFORE)
        after_time = LAST_ACTION_AFTER if is_last_click else ACTION_AFTER
        action_end = min(video_duration, t + after_time)

        # Handle gap before this action
        gap = action_start - prev_action_end
        if gap > 0:
            if gap > MAX_TRANSITION:
                transition_start = action_start - MAX_TRANSITION
                if transition_start > prev_action_end:
                    video_segments.append((transition_start, action_start, FAST_SPEED))
                elif prev_action_end < action_start:
                    video_segments.append((prev_action_end, action_start, FAST_SPEED))
            else:
                video_segments.append((prev_action_end, action_start, FAST_SPEED))

        # Action segment at normal speed
        if video_segments and video_segments[-1][2] == 1 and action_start <= video_segments[-1][1]:
            video_segments[-1] = (video_segments[-1][0], action_end, 1)
        else:
            video_segments.append((action_start, action_end, 1))

        prev_action_end = action_end

    # Handle end of video
    if prev_action_end < video_duration:
        remaining = video_duration - prev_action_end
        if remaining > END_OF_VIDEO_BUFFER:
            video_segments.append((prev_action_end, prev_action_end + END_OF_VIDEO_BUFFER, 1))
            if prev_action_end + END_OF_VIDEO_BUFFER < video_duration:
                video_segments.append((prev_action_end + END_OF_VIDEO_BUFFER, video_duration, FAST_SPEED))
        else:
            video_segments.append((prev_action_end, video_duration, 1))

    log(f"Video segments: {video_segments}")

    # Build complex filter for trimming and speed adjustment
    filter_parts = []
    concat_inputs = []

    for i, (start, end, speed) in enumerate(video_segments):
        if end <= start:
            continue
        pts_factor = 1.0 / speed
        filter_parts.append(f"[0:v]trim=start={start:.3f}:end={end:.3f},setpts={pts_factor}*PTS[v{i}]")
        concat_inputs.append(f"[v{i}]")

    if not concat_inputs:
        log("No segments to process")
        return False

    n_segments = len(concat_inputs)
    filter_complex = ";".join(filter_parts) + f";{''.join(concat_inputs)}concat=n={n_segments}:v=1:a=0[out]"

    result = subprocess.run([
        "ffmpeg", "-y",
        "-i", f"{outdir}/with_cursor.mp4",
        "-filter_complex", filter_complex,
        "-map", "[out]",
        "-movflags", "+faststart",
        f"{outdir}/workflow.mp4"
    ], capture_output=True, text=True)

    if result.returncode != 0:
        log(f"Trim/speedup failed: {result.stderr}")
        return False

    # Cleanup intermediate file
    os.remove(f"{outdir}/with_cursor.mp4")

    total_dur = sum((end - start) / speed for start, end, speed in video_segments)
    log(f"Final video: {n_segments} segments, ~{total_dur:.1f}s (from {video_duration:.1f}s original)")

    return True


def process_no_clicks(outdir):
    """Process video when there are no clicks - just add centered cursor and speed up."""
    log("No clicks found, drawing cursor at center and speeding up 2x")
    cx, cy = 960, 540
    cursor_path = f"{outdir}/cursor.png"

    if create_cursor_png(cursor_path):
        tip_offset = 4
        result = subprocess.run([
            "ffmpeg", "-y",
            "-i", f"{outdir}/raw.mp4",
            "-i", cursor_path,
            "-filter_complex", f"[0:v][1:v]overlay=x={cx-tip_offset}:y={cy-tip_offset},setpts=0.5*PTS[out]",
            "-map", "[out]",
            "-movflags", "+faststart",
            f"{outdir}/workflow.mp4"
        ], capture_output=True, text=True)

        if result.returncode == 0:
            os.remove(f"{outdir}/raw.mp4")
            return True

    # Fallback to just speed up
    result = subprocess.run(
        f'ffmpeg -y -i "{outdir}/raw.mp4" -vf "setpts=0.5*PTS" -movflags +faststart "{outdir}/workflow.mp4"',
        shell=True, capture_output=True, text=True
    )

    if result.returncode == 0:
        os.remove(f"{outdir}/raw.mp4")
        return True

    # Last resort: just copy
    os.rename(f"{outdir}/raw.mp4", f"{outdir}/workflow.mp4")
    return True


def generate_gif_preview(outdir, workflow_path):
    """Generate GIF preview for GitHub comments using two-pass palette."""
    gif_path = f"{outdir}/workflow.gif"
    palette_path = f"{outdir}/palette.png"

    if not os.path.exists(workflow_path):
        log("No workflow video to generate GIF from")
        return False

    gif_success = False

    for fps in [15, 10, 8, 6]:
        log(f"Generating GIF preview (two-pass palette @ {fps}fps)...")

        try:
            # Pass 1: Generate optimized palette
            subprocess.run([
                "ffmpeg", "-y", "-i", workflow_path,
                "-vf", f"fps={fps},palettegen=stats_mode=diff:max_colors=256",
                palette_path
            ], capture_output=True, text=True, timeout=60)

            if not os.path.exists(palette_path):
                continue

            # Pass 2: Generate GIF using palette
            result = subprocess.run([
                "ffmpeg", "-y", "-i", workflow_path, "-i", palette_path,
                "-lavfi", f"fps={fps}[x];[x][1:v]paletteuse=dither=floyd_steinberg:diff_mode=rectangle",
                gif_path
            ], capture_output=True, text=True, timeout=90)

            if result.returncode == 0 and os.path.exists(gif_path):
                gif_size = os.path.getsize(gif_path)
                gif_size_mb = gif_size / 1024 / 1024
                log(f"GIF @ {fps}fps: {gif_size_mb:.2f} MB")

                if gif_size_mb <= CONVEX_SIZE_LIMIT_MB:
                    gif_success = True
                    log(f"GIF fits within {CONVEX_SIZE_LIMIT_MB}MB limit!")
                    break
                else:
                    log(f"GIF too large, trying lower fps...")
                    os.remove(gif_path)

        except subprocess.TimeoutExpired:
            log(f"GIF generation timed out at {fps}fps")

    # Cleanup palette
    if os.path.exists(palette_path):
        os.remove(palette_path)

    if not gif_success and os.path.exists(gif_path):
        os.remove(gif_path)

    return gif_success


def apply_metadata_rename(outdir, workflow_path, gif_path):
    """Rename output files based on video-metadata.json if present."""
    import re

    metadata_path = f"{outdir}/video-metadata.json"
    if not os.path.exists(metadata_path):
        return

    try:
        with open(metadata_path) as f:
            metadata = json.load(f)

        custom_filename = metadata.get("fileName", "").strip()
        if custom_filename:
            # Sanitize filename
            safe_filename = re.sub(r'[^a-zA-Z0-9_-]', '-', custom_filename)
            safe_filename = re.sub(r'-+', '-', safe_filename).strip('-')

            if safe_filename:
                new_mp4_path = f"{outdir}/{safe_filename}.mp4"
                new_gif_path = f"{outdir}/{safe_filename}.gif"

                if os.path.exists(workflow_path) and workflow_path != new_mp4_path:
                    os.rename(workflow_path, new_mp4_path)
                    log(f"Renamed video: {workflow_path} -> {new_mp4_path}")

                if os.path.exists(gif_path) and gif_path != new_gif_path:
                    os.rename(gif_path, new_gif_path)
                    log(f"Renamed GIF: {gif_path} -> {new_gif_path}")

        log(f"Video metadata: {metadata}")

    except Exception as e:
        log(f"Warning: Could not process video metadata: {e}")


def cleanup_temp_files(outdir):
    """Remove temporary files."""
    cursor_path = f"{outdir}/cursor.png"
    if os.path.exists(cursor_path):
        os.remove(cursor_path)
        log("Cleaned up cursor.png")


def main():
    if len(sys.argv) < 2:
        print("Usage: python3 post_process_video.py <output_dir>", file=sys.stderr)
        sys.exit(1)

    outdir = sys.argv[1]
    events_log_path = f"{outdir}/events.log"
    raw_path = f"{outdir}/raw.mp4"
    workflow_path = f"{outdir}/workflow.mp4"
    gif_path = f"{outdir}/workflow.gif"

    # Parse click events
    clicks, recording_start_ms = parse_events_log(events_log_path)

    # Validate raw video
    if not validate_raw_video(raw_path, outdir):
        # validate_raw_video handles salvage cases
        if os.path.exists(workflow_path):
            generate_gif_preview(outdir, workflow_path)
            apply_metadata_rename(outdir, workflow_path, gif_path)
            cleanup_temp_files(outdir)
        sys.exit(0)

    # Convert timestamps to relative time
    if clicks:
        first_ts = clicks[0][0]
        clicks = [(0.5 + (ts - first_ts) / 1000.0, x, y) for ts, x, y in clicks]
        log(f"Adjusted clicks: {clicks}")

    if clicks:
        # Add cursor overlay
        success = add_cursor_overlay_png(outdir, clicks)
        if not success:
            success = add_cursor_overlay_drawtext(outdir, clicks)

        if success:
            # Get video duration
            probe = subprocess.run([
                "ffprobe", "-v", "error", "-show_entries", "format=duration",
                "-of", "default=noprint_wrappers=1:nokey=1",
                f"{outdir}/with_cursor.mp4"
            ], capture_output=True, text=True)

            try:
                video_duration = float(probe.stdout.strip())
            except:
                video_duration = 30.0  # fallback

            log(f"Video duration: {video_duration:.1f}s")

            # Trim and speed up
            if trim_and_speedup(outdir, clicks, video_duration):
                os.remove(raw_path)
            else:
                # Fallback: just rename
                if os.path.exists(f"{outdir}/with_cursor.mp4"):
                    os.rename(f"{outdir}/with_cursor.mp4", workflow_path)
                else:
                    os.rename(raw_path, workflow_path)
        else:
            # Cursor overlay failed, just rename raw
            os.rename(raw_path, workflow_path)
    else:
        # No clicks
        process_no_clicks(outdir)

    # Validate final video
    if os.path.exists(workflow_path):
        probe = subprocess.run([
            "ffprobe", "-v", "error", "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1", workflow_path
        ], capture_output=True, text=True)

        if probe.returncode == 0:
            log(f"Final video duration: {probe.stdout.strip()}s")
        else:
            log(f"WARNING: Final video may be corrupted")
    else:
        log("ERROR: No output video created")

    # Generate GIF preview
    generate_gif_preview(outdir, workflow_path)

    # Apply metadata rename
    apply_metadata_rename(outdir, workflow_path, gif_path)

    # Cleanup
    cleanup_temp_files(outdir)

    log("Post-processing complete!")


if __name__ == "__main__":
    main()
