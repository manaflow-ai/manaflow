#!/usr/bin/env python3
"""
Test script to generate and preview the cursor PNG used in video overlays.
This draws the same cursor that ffmpeg overlays onto recorded videos.

Usage:
    python scripts/draw-cursor-test.py [output_path]

Output:
    Creates a PNG file showing the cursor on a transparent background,
    and also creates a preview image showing the cursor on different backgrounds.
"""

import sys
import os

try:
    from PIL import Image, ImageDraw
except ImportError:
    print("Error: PIL/Pillow is required. Install with: pip install Pillow")
    sys.exit(1)

def draw_cursor(size_multiplier: float = 1.0) -> Image.Image:
    """
    Draw a clean mouse cursor - white fill with black border.
    """
    # Draw at 4x size then scale down for smooth edges
    scale = 4

    # Final output size
    out_w, out_h = int(24 * size_multiplier), int(32 * size_multiplier)

    # Work size
    w, h = out_w * scale, out_h * scale

    img = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Classic arrow cursor - symmetric with inward notch on both sides
    s = scale * size_multiplier
    cursor = [
        (4*s, 4*s),      # tip (top)
        (4*s, 20*s),     # left edge down
        (8*s, 16*s),     # left notch (inward)
        (11*s, 23*s),    # tail left
        (13*s, 21*s),    # tail right
        (10*s, 14*s),    # right notch (inward)
        (14*s, 10*s),    # right edge
    ]

    # Draw black border first (expanded)
    border = 2 * s
    for dx in [-border, 0, border]:
        for dy in [-border, 0, border]:
            pts = [(x+dx, y+dy) for x, y in cursor]
            draw.polygon(pts, fill='black')

    # Draw white fill on top
    draw.polygon(cursor, fill='white')

    # Scale down with antialiasing
    img = img.resize((out_w, out_h), Image.LANCZOS)

    return img


def create_preview_image(cursor_img: Image.Image, output_path: str):
    """
    Create a preview image showing the cursor on different backgrounds.
    """
    # Create a preview canvas with different background sections
    preview_width = 400
    preview_height = 300
    preview = Image.new('RGBA', (preview_width, preview_height), (255, 255, 255, 255))
    draw = ImageDraw.Draw(preview)

    # Draw different background sections
    section_width = preview_width // 4

    # Section 1: White background (already white)
    # Section 2: Light gray
    draw.rectangle([section_width, 0, section_width * 2, preview_height], fill=(200, 200, 200, 255))
    # Section 3: Dark gray
    draw.rectangle([section_width * 2, 0, section_width * 3, preview_height], fill=(60, 60, 60, 255))
    # Section 4: Black
    draw.rectangle([section_width * 3, 0, preview_width, preview_height], fill=(0, 0, 0, 255))

    # Add a gradient bar at the top
    for x in range(preview_width):
        gray = int(255 * (1 - x / preview_width))
        draw.line([(x, 0), (x, 30)], fill=(gray, gray, gray, 255))

    # Add some colored sections
    colors = [
        (66, 133, 244, 255),   # Blue
        (52, 168, 83, 255),    # Green
        (251, 188, 4, 255),    # Yellow
        (234, 67, 53, 255),    # Red
    ]
    color_section_height = 40
    for i, color in enumerate(colors):
        y_start = preview_height - color_section_height
        x_start = i * section_width
        draw.rectangle([x_start, y_start, x_start + section_width, preview_height], fill=color)

    # Paste cursors at various positions
    cursor_positions = [
        (50, 80),    # On white
        (150, 120),  # On light gray
        (250, 100),  # On dark gray
        (350, 140),  # On black
        (100, 260),  # On blue
        (200, 270),  # On green
        (300, 265),  # On yellow
        (380, 275),  # On red
        (200, 15),   # On gradient
    ]

    for x, y in cursor_positions:
        preview.paste(cursor_img, (x, y), cursor_img)

    # Add labels
    try:
        from PIL import ImageFont
        font = ImageFont.load_default()
    except:
        font = None

    # Save the preview
    preview.save(output_path.replace('.png', '_preview.png'))
    print(f"Preview image saved to: {output_path.replace('.png', '_preview.png')}")


def main():
    # Determine output path
    if len(sys.argv) > 1:
        output_path = sys.argv[1]
    else:
        output_path = "/tmp/cursor_test.png"

    # Ensure output directory exists
    output_dir = os.path.dirname(output_path)
    if output_dir and not os.path.exists(output_dir):
        os.makedirs(output_dir)

    print("Drawing cursor...")

    # Draw cursor at 1x scale
    cursor_1x = draw_cursor(1.0)
    cursor_1x.save(output_path)
    print(f"Cursor (1x) saved to: {output_path}")

    # Draw cursor at 2x scale for better visibility
    cursor_2x = draw_cursor(2.0)
    output_2x = output_path.replace('.png', '_2x.png')
    cursor_2x.save(output_2x)
    print(f"Cursor (2x) saved to: {output_2x}")

    # Create preview image showing cursor on different backgrounds
    create_preview_image(cursor_1x, output_path)

    print("\nCursor properties:")
    print(f"  Size (1x): {cursor_1x.size[0]}x{cursor_1x.size[1]} pixels")
    print(f"  Size (2x): {cursor_2x.size[0]}x{cursor_2x.size[1]} pixels")
    print(f"  Format: RGBA (transparent background)")
    print(f"  Style: Classic arrow - white fill, black border")
    print(f"  Tip position: Top-left corner")

    print(f"\nOpen the preview image to verify the cursor looks good:")
    print(f"  open {output_path.replace('.png', '_preview.png')}")


if __name__ == "__main__":
    main()
