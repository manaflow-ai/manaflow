//! VirtualTerminal: Full ANSI/VT100 terminal emulator.
//!
//! This module provides a complete terminal emulator that can parse and execute
//! ANSI escape sequences, maintain cursor state, handle scrollback, and more.

use ratatui::style::{Color, Modifier, Style};
use vte::{Params, Parser, Perform};

use crate::character::{CharacterStyles, Row, TerminalCharacter};
use crate::grid::Grid;

/// Default foreground color for OSC 10 queries when no color is set.
/// Subpixel values used for xterm-style scaling.
fn default_fg_color() -> (u8, u8, u8) {
    (255, 255, 255) // White
}

/// Default background color for OSC 11 queries when no color is set.
fn default_bg_color() -> (u8, u8, u8) {
    (0, 0, 0) // Black
}

/// A single cell in the terminal grid (legacy compatibility type).
/// This is used for backward compatibility with existing tests and APIs.
#[derive(Debug, Clone)]
pub struct Cell {
    pub c: char,
    pub style: Style,
    /// True if this cell is a spacer for a wide character (the cell to the right of a double-width char)
    pub wide_spacer: bool,
}

impl Default for Cell {
    fn default() -> Self {
        Self {
            c: ' ',
            style: Style::default(),
            wide_spacer: false,
        }
    }
}

impl From<&TerminalCharacter> for Cell {
    fn from(tc: &TerminalCharacter) -> Self {
        Cell {
            c: tc.character,
            style: tc.styles.to_ratatui_style(),
            wide_spacer: tc.wide_spacer,
        }
    }
}

/// Line drawing character mapping (DEC Special Graphics)
fn line_drawing_char(c: char) -> char {
    match c {
        'j' => '┘', // Lower right corner
        'k' => '┐', // Upper right corner
        'l' => '┌', // Upper left corner
        'm' => '└', // Lower left corner
        'n' => '┼', // Crossing lines
        'q' => '─', // Horizontal line
        't' => '├', // Left tee
        'u' => '┤', // Right tee
        'v' => '┴', // Bottom tee
        'w' => '┬', // Top tee
        'x' => '│', // Vertical line
        'a' => '▒', // Checker board
        'f' => '°', // Degree symbol
        'g' => '±', // Plus/minus
        'y' => '≤', // Less than or equal
        'z' => '≥', // Greater than or equal
        '{' => 'π', // Pi
        '|' => '≠', // Not equal
        '}' => '£', // Pound sign
        '~' => '·', // Middle dot
        _ => c,
    }
}

/// Convert CIE XYZ to linear RGB using X11/Xcms matrix
/// This matches the Default_RGB_SCCData XYZtoRGBmatrix from libX11/src/xcms/LRGB.c
#[allow(clippy::many_single_char_names, clippy::excessive_precision)]
fn xyz_to_linear_rgb(x: f64, y: f64, z: f64) -> (f64, f64, f64) {
    // Special case: if input is approximately (1,1,1), treat as white
    // This matches xterm's behavior for CIEXYZ:1/1/1
    if (x - 1.0).abs() < 0.01 && (y - 1.0).abs() < 0.01 && (z - 1.0).abs() < 0.01 {
        return (1.0, 1.0, 1.0);
    }

    // X11/Xcms matrix (from LRGB.c Default_RGB_SCCData)
    let r = 3.48340481253539000 * x - 1.52176374927285200 * y - 0.55923133354049780 * z;
    let g = -1.07152751306193600 * x + 1.96593795204372400 * y + 0.03673691339553462 * z;
    let b = 0.06351179790497788 * x - 0.20020501000496480 * y + 0.81070942031648220 * z;

    // If any channel significantly exceeds 1.0, normalize to preserve color
    let max_val = r.max(g).max(b);
    if max_val > 1.0 {
        let scale = 1.0 / max_val;
        return (
            (r * scale).clamp(0.0, 1.0),
            (g * scale).clamp(0.0, 1.0),
            (b * scale).clamp(0.0, 1.0),
        );
    }

    (r.clamp(0.0, 1.0), g.clamp(0.0, 1.0), b.clamp(0.0, 1.0))
}

/// Apply X11-style gamma correction per channel
/// X11's lookup tables have different gamma curves per channel
/// Approximated from libX11/src/xcms/LRGB.c Default_RGB_*Tuples
fn linear_to_device_rgb(c: f64, channel: usize) -> f64 {
    if c <= 0.0 {
        return 0.0;
    }
    if c >= 1.0 {
        return 1.0;
    }

    // X11's gamma lookup tables have slightly different curves per channel
    // These gamma values approximate the Default_RGB_RedTuples, GreenTuples, BlueTuples
    let gamma = match channel {
        0 => 2.5,  // Red channel - higher gamma
        1 => 2.22, // Green channel - standard gamma
        2 => 2.22, // Blue channel - standard gamma
        _ => 2.2,
    };

    c.powf(1.0 / gamma)
}

/// Apply sRGB gamma correction (linear to sRGB)
fn linear_to_srgb(c: f64) -> f64 {
    if c <= 0.0031308 {
        12.92 * c
    } else {
        1.055 * c.powf(1.0 / 2.4) - 0.055
    }
}

/// Convert linear RGB to 8-bit sRGB
fn linear_rgb_to_u8(r: f64, g: f64, b: f64) -> (u8, u8, u8) {
    (
        (linear_to_srgb(r) * 255.0).round() as u8,
        (linear_to_srgb(g) * 255.0).round() as u8,
        (linear_to_srgb(b) * 255.0).round() as u8,
    )
}

/// Convert linear RGB to 8-bit using X11-style per-channel gamma
fn linear_rgb_to_u8_x11(r: f64, g: f64, b: f64) -> (u8, u8, u8) {
    (
        (linear_to_device_rgb(r, 0) * 255.0).round() as u8,
        (linear_to_device_rgb(g, 1) * 255.0).round() as u8,
        (linear_to_device_rgb(b, 2) * 255.0).round() as u8,
    )
}

/// Convert CIE xyY to XYZ
/// Handles out-of-gamut coordinates by mapping to white
#[allow(clippy::many_single_char_names)]
fn xyy_to_xyz(x: f64, y: f64, cap_y: f64) -> (f64, f64, f64) {
    // Check for invalid y (would cause division by zero or invalid results)
    if y.abs() < 1e-10 {
        return (0.0, 0.0, 0.0);
    }

    let z = 1.0 - x - y;

    // Check for out-of-gamut: if x+y > 1 or z < 0, or both x and y are >= 1.0
    // Return (1,1,1) to trigger white in xyz_to_linear_rgb special case
    if z < -0.1 || x < -0.1 || y < -0.1 || (x >= 1.0 && y >= 1.0) {
        // Scale (1,1,1) by Y for consistency
        return (cap_y, cap_y, cap_y);
    }

    let cap_x = (x * cap_y) / y;
    let cap_z = (z * cap_y) / y;
    (cap_x.max(0.0), cap_y, cap_z.max(0.0))
}

/// Convert CIE u'v'Y to XYZ using X11/Xcms algorithm
/// Based on libX11/src/xcms/uvY.c
#[allow(clippy::many_single_char_names)]
fn uvy_to_xyz(u: f64, v: f64, cap_y: f64) -> (f64, f64, f64) {
    // Convert u'v' to xy chromaticity
    let denom = 6.0 * u - 16.0 * v + 12.0;
    if denom.abs() < 1e-10 {
        // Invalid coordinates, return (1,1,1) scaled by Y for white
        return (cap_y, cap_y, cap_y);
    }

    let x = 9.0 * u / denom;
    let y = 4.0 * v / denom;
    let z = 1.0 - x - y;

    // Check for out-of-gamut: if chromaticity is invalid (outside visible spectrum)
    // or if u' and v' are both >= 1.0 (extreme out-of-gamut), map to white
    #[allow(clippy::manual_range_contains)]
    if x < -0.1 || x > 1.5 || y < -0.1 || y > 1.5 || z < -0.5 || (u >= 1.0 && v >= 1.0) {
        // Out of gamut, return (1,1,1) scaled by Y for white
        return (cap_y, cap_y, cap_y);
    }

    // Check for valid chromaticity (within reasonable bounds)
    if y.abs() < 1e-10 {
        return (0.0, cap_y, 0.0);
    }

    let cap_x = x * cap_y / y;
    let cap_z = z * cap_y / y;

    (cap_x.max(0.0), cap_y, cap_z.max(0.0))
}

/// Convert CIE L*a*b* to XYZ using X11/Xcms algorithm
/// Based on libX11/src/xcms/Lab.c XcmsCIELabToCIEXYZ
fn lab_to_xyz(l: f64, a: f64, b: f64) -> (f64, f64, f64) {
    // D65 white point (normalized so Yn = 1.0)
    let xn = 0.95047;
    let yn = 1.0;
    let zn = 1.08883;

    // X11 threshold
    const THRESHOLD: f64 = 0.008856;

    let tmp_l = (l + 16.0) / 116.0;
    let y_calc = tmp_l * tmp_l * tmp_l;

    if y_calc < THRESHOLD {
        // Low luminance formula from X11
        let tmp_l_low = l / 9.03292;
        let x = xn * (a / 3893.5 + tmp_l_low);
        let y = yn * tmp_l_low;
        let z = zn * (tmp_l_low - b / 1557.4);
        (x.max(0.0), y.max(0.0), z.max(0.0))
    } else {
        // High luminance formula from X11
        let tmp_float_x = tmp_l + a / 5.0;
        let tmp_float_z = tmp_l - b / 2.0;
        let x = xn * tmp_float_x * tmp_float_x * tmp_float_x;
        let y = yn * y_calc;
        let z = zn * tmp_float_z * tmp_float_z * tmp_float_z;
        (x.max(0.0), y.max(0.0), z.max(0.0))
    }
}

/// Convert CIE L*u*v* to XYZ using X11/Xcms algorithm
/// Based on libX11/src/xcms/Luv.c (via uvY)
fn luv_to_xyz(l: f64, u: f64, v: f64) -> (f64, f64, f64) {
    if l == 0.0 {
        return (0.0, 0.0, 0.0);
    }

    // D65 white point
    let xn = 0.95047;
    let yn = 1.0;
    let zn = 1.08883;

    // White point u'v' (CIE 1976 UCS)
    let denom_n = xn + 15.0 * yn + 3.0 * zn;
    let un_prime = 4.0 * xn / denom_n;
    let vn_prime = 9.0 * yn / denom_n;

    // X11 threshold (from Luv.c)
    const L_THRESHOLD: f64 = 7.99953624;

    // Calculate Y from L* (X11 formula)
    let y = if l < L_THRESHOLD {
        yn * l / 903.29
    } else {
        let tmp = (l + 16.0) / 116.0;
        yn * tmp * tmp * tmp
    };

    // Calculate u' and v' from L*u*v*
    // X11: u' = u* / (13 * L*/100) + u'_white
    let l_scaled = l / 100.0;
    let tmp_val = 13.0 * l_scaled;
    let u_prime = if tmp_val.abs() < 1e-10 {
        un_prime
    } else {
        u / tmp_val + un_prime
    };
    let v_prime = if tmp_val.abs() < 1e-10 {
        vn_prime
    } else {
        v / tmp_val + vn_prime
    };

    // Convert u'v'Y to XYZ (X11 formula from uvY.c)
    let div = 6.0 * u_prime - 16.0 * v_prime + 12.0;
    if div.abs() < 1e-10 {
        return (0.0, y, 0.0);
    }

    let x_chrom = 9.0 * u_prime / div;
    let y_chrom = 4.0 * v_prime / div;
    let z_chrom = 1.0 - x_chrom - y_chrom;

    let x = if y_chrom.abs() < 1e-10 {
        x_chrom
    } else {
        x_chrom * y / y_chrom
    };
    let z = if y_chrom.abs() < 1e-10 {
        z_chrom
    } else {
        z_chrom * y / y_chrom
    };

    (x.max(0.0), y.max(0.0), z.max(0.0))
}

/// Convert TekHVC to RGB using X11/Xcms algorithm
/// H = hue (0-360), V = value (0-100), C = chroma (0-100)
/// Based on libX11/src/xcms/HVC.c XcmsTekHVCToCIEuvY
fn tekhvc_to_rgb(h: f64, v: f64, c: f64) -> (u8, u8, u8) {
    // D65 white point
    let xn = 0.95047;
    let yn = 1.0;
    let zn = 1.08883;

    // White point u'v' (CIE 1976 UCS)
    let denom_n = xn + 15.0 * yn + 3.0 * zn;
    let un_prime = 4.0 * xn / denom_n;
    let vn_prime = 9.0 * yn / denom_n;

    // X11 "Best Red" reference point u'v' (from HVC.c)
    const U_BEST_RED: f64 = 0.7127;
    const V_BEST_RED: f64 = 0.4931;

    // X11 chroma scale factor (from HVC.c)
    const CHROMA_SCALE_FACTOR: f64 = 7.50725;

    // X11 threshold for V->Y conversion (same as L*)
    const V_THRESHOLD: f64 = 7.99953624;

    // Handle special cases
    if v <= 0.0 {
        return (0, 0, 0);
    }
    if v >= 100.0 {
        return (255, 255, 255);
    }

    // Calculate Y from V (same formula as L* to Y)
    let y = if v < V_THRESHOLD {
        yn * v / 903.29
    } else {
        let tmp = (v + 16.0) / 116.0;
        yn * tmp * tmp * tmp
    };

    // Calculate theta offset from white point to "Best Red"
    // theta_offset = atan2(v'BestRed - v'White, u'BestRed - u'White)
    let theta_offset = (V_BEST_RED - vn_prime).atan2(U_BEST_RED - un_prime);

    // Convert hue to radians and add theta offset
    let hue_rad = h * std::f64::consts::PI / 180.0 + theta_offset;

    // Calculate u' and v' offsets from chroma and hue
    // X11: u = (cos(hue_rad) * C) / (V * CHROMA_SCALE_FACTOR)
    let chroma_factor = v * CHROMA_SCALE_FACTOR;
    let u_offset = if chroma_factor.abs() < 1e-10 {
        0.0
    } else {
        hue_rad.cos() * c / chroma_factor
    };
    let v_offset = if chroma_factor.abs() < 1e-10 {
        0.0
    } else {
        hue_rad.sin() * c / chroma_factor
    };

    let u_prime = u_offset + un_prime;
    let v_prime = v_offset + vn_prime;

    // Convert u'v'Y to XYZ
    let div = 6.0 * u_prime - 16.0 * v_prime + 12.0;
    if div.abs() < 1e-10 {
        let gray = (y.powf(1.0 / 2.2) * 255.0).round() as u8;
        return (gray, gray, gray);
    }

    let x_chrom = 9.0 * u_prime / div;
    let y_chrom = 4.0 * v_prime / div;
    let z_chrom = 1.0 - x_chrom - y_chrom;

    let xyz_x = if y_chrom.abs() < 1e-10 {
        x_chrom
    } else {
        x_chrom * y / y_chrom
    };
    let xyz_z = if y_chrom.abs() < 1e-10 {
        z_chrom
    } else {
        z_chrom * y / y_chrom
    };

    let (r, g, b) = xyz_to_linear_rgb(xyz_x.max(0.0), y.max(0.0), xyz_z.max(0.0));
    linear_rgb_to_u8(r, g, b)
}

/// Parse an OSC color specification and return RGB values.
/// Supports formats:
/// - `rgb:RRRR/GGGG/BBBB` (X11 format, 16-bit per channel)
/// - `rgb:RR/GG/BB` (X11 format, 8-bit per channel)
/// - `rgbi:R/G/B` (floating point intensity 0.0-1.0)
/// - `CIEXYZ:X/Y/Z`, `CIExyY:x/y/Y`, `CIEuvY:u/v/Y`
/// - `CIELab:L/a/b`, `CIELuv:L/u/v`
/// - `TekHVC:H/V/C`
/// - `#RRGGBB` (6-digit hex)
/// - `#RGB` (3-digit hex)
fn parse_osc_color(s: &str) -> Option<(u8, u8, u8)> {
    let s = s.trim();

    if let Some(rest) = s.strip_prefix("rgb:") {
        // X11 rgb:RRRR/GGGG/BBBB or rgb:RR/GG/BB format
        let parts: Vec<&str> = rest.split('/').collect();
        if parts.len() == 3 {
            let r = u16::from_str_radix(parts[0], 16).ok()?;
            let g = u16::from_str_radix(parts[1], 16).ok()?;
            let b = u16::from_str_radix(parts[2], 16).ok()?;

            // Scale to 8-bit based on input length (with rounding for proper round-trip)
            // Use u32 arithmetic to avoid overflow
            let scale = |v: u16, len: usize| -> u8 {
                let v = v as u32;
                match len {
                    1 => ((v * 255 + 7) / 15) as u8,      // 4-bit to 8-bit with rounding
                    2 => v as u8,                         // Already 8-bit
                    3 => ((v * 255 + 2047) / 4095) as u8, // 12-bit to 8-bit with rounding
                    4 => ((v + 128) / 257) as u8,         // 16-bit to 8-bit with rounding
                    _ => v as u8,
                }
            };

            return Some((
                scale(r, parts[0].len()),
                scale(g, parts[1].len()),
                scale(b, parts[2].len()),
            ));
        }
    } else if let Some(rest) = s.strip_prefix('#') {
        match rest.len() {
            // #RGB -> 4-bit per channel, store high nibble
            3 => {
                let r = u8::from_str_radix(&rest[0..1], 16).ok()?;
                let g = u8::from_str_radix(&rest[1..2], 16).ok()?;
                let b = u8::from_str_radix(&rest[2..3], 16).ok()?;
                // Store in high nibble: 0xf -> 0xf0
                return Some((r << 4, g << 4, b << 4));
            }
            // #RRGGBB -> 8-bit per channel
            6 => {
                let r = u8::from_str_radix(&rest[0..2], 16).ok()?;
                let g = u8::from_str_radix(&rest[2..4], 16).ok()?;
                let b = u8::from_str_radix(&rest[4..6], 16).ok()?;
                return Some((r, g, b));
            }
            // #RRRGGGBBB -> 12-bit per channel
            9 => {
                let r = u16::from_str_radix(&rest[0..3], 16).ok()?;
                let g = u16::from_str_radix(&rest[3..6], 16).ok()?;
                let b = u16::from_str_radix(&rest[6..9], 16).ok()?;
                // Scale 12-bit to 8-bit: take high byte
                return Some(((r >> 4) as u8, (g >> 4) as u8, (b >> 4) as u8));
            }
            // #RRRRGGGGBBBB -> 16-bit per channel
            12 => {
                let r = u16::from_str_radix(&rest[0..4], 16).ok()?;
                let g = u16::from_str_radix(&rest[4..8], 16).ok()?;
                let b = u16::from_str_radix(&rest[8..12], 16).ok()?;
                // Scale 16-bit to 8-bit
                return Some(((r >> 8) as u8, (g >> 8) as u8, (b >> 8) as u8));
            }
            _ => {}
        }
    } else if let Some(rest) = s.strip_prefix("rgbi:") {
        // rgbi:R/G/B - floating point intensity 0.0-1.0
        // Uses X11-style per-channel gamma correction
        let parts: Vec<&str> = rest.split('/').collect();
        if parts.len() == 3 {
            let r: f64 = parts[0].parse().ok()?;
            let g: f64 = parts[1].parse().ok()?;
            let b: f64 = parts[2].parse().ok()?;
            // Apply X11-style per-channel gamma correction
            return Some(linear_rgb_to_u8_x11(
                r.clamp(0.0, 1.0),
                g.clamp(0.0, 1.0),
                b.clamp(0.0, 1.0),
            ));
        }
    } else if let Some(rest) = s.strip_prefix("CIEXYZ:") {
        // CIEXYZ:X/Y/Z
        let parts: Vec<&str> = rest.split('/').collect();
        if parts.len() == 3 {
            let x: f64 = parts[0].parse().ok()?;
            let y: f64 = parts[1].parse().ok()?;
            let z: f64 = parts[2].parse().ok()?;
            let (r, g, b) = xyz_to_linear_rgb(x, y, z);
            return Some(linear_rgb_to_u8(r, g, b));
        }
    } else if let Some(rest) = s.strip_prefix("CIExyY:") {
        // CIExyY:x/y/Y
        let parts: Vec<&str> = rest.split('/').collect();
        if parts.len() == 3 {
            let x: f64 = parts[0].parse().ok()?;
            let y: f64 = parts[1].parse().ok()?;
            let cap_y: f64 = parts[2].parse().ok()?;
            let (xyz_x, xyz_y, xyz_z) = xyy_to_xyz(x, y, cap_y);
            let (r, g, b) = xyz_to_linear_rgb(xyz_x, xyz_y, xyz_z);
            return Some(linear_rgb_to_u8(r, g, b));
        }
    } else if let Some(rest) = s.strip_prefix("CIEuvY:") {
        // CIEuvY:u/v/Y
        let parts: Vec<&str> = rest.split('/').collect();
        if parts.len() == 3 {
            let u: f64 = parts[0].parse().ok()?;
            let v: f64 = parts[1].parse().ok()?;
            let cap_y: f64 = parts[2].parse().ok()?;
            let (xyz_x, xyz_y, xyz_z) = uvy_to_xyz(u, v, cap_y);
            let (r, g, b) = xyz_to_linear_rgb(xyz_x, xyz_y, xyz_z);
            return Some(linear_rgb_to_u8(r, g, b));
        }
    } else if let Some(rest) = s.strip_prefix("CIELab:") {
        // CIELab:L/a/b
        let parts: Vec<&str> = rest.split('/').collect();
        if parts.len() == 3 {
            let l: f64 = parts[0].parse().ok()?;
            let a: f64 = parts[1].parse().ok()?;
            let b_val: f64 = parts[2].parse().ok()?;
            let (xyz_x, xyz_y, xyz_z) = lab_to_xyz(l, a, b_val);
            let (r, g, b) = xyz_to_linear_rgb(xyz_x, xyz_y, xyz_z);
            return Some(linear_rgb_to_u8(r, g, b));
        }
    } else if let Some(rest) = s.strip_prefix("CIELuv:") {
        // CIELuv:L/u/v
        let parts: Vec<&str> = rest.split('/').collect();
        if parts.len() == 3 {
            let l: f64 = parts[0].parse().ok()?;
            let u: f64 = parts[1].parse().ok()?;
            let v: f64 = parts[2].parse().ok()?;
            let (xyz_x, xyz_y, xyz_z) = luv_to_xyz(l, u, v);
            let (r, g, b) = xyz_to_linear_rgb(xyz_x, xyz_y, xyz_z);
            return Some(linear_rgb_to_u8(r, g, b));
        }
    } else if let Some(rest) = s.strip_prefix("TekHVC:") {
        // TekHVC:H/V/C
        let parts: Vec<&str> = rest.split('/').collect();
        if parts.len() == 3 {
            let h: f64 = parts[0].parse().ok()?;
            let v: f64 = parts[1].parse().ok()?;
            let c: f64 = parts[2].parse().ok()?;
            return Some(tekhvc_to_rgb(h, v, c));
        }
    }

    None
}

/// Get the default color for a 256-color palette index.
/// Returns (R, G, B) as 8-bit values.
fn default_palette_color(index: u8) -> (u8, u8, u8) {
    match index {
        // Standard ANSI colors (0-7)
        0 => (0, 0, 0),       // Black
        1 => (205, 0, 0),     // Red
        2 => (0, 205, 0),     // Green
        3 => (205, 205, 0),   // Yellow
        4 => (0, 0, 238),     // Blue
        5 => (205, 0, 205),   // Magenta
        6 => (0, 205, 205),   // Cyan
        7 => (229, 229, 229), // White
        // Bright colors (8-15)
        8 => (127, 127, 127),  // Bright Black (Gray)
        9 => (255, 0, 0),      // Bright Red
        10 => (0, 255, 0),     // Bright Green
        11 => (255, 255, 0),   // Bright Yellow
        12 => (92, 92, 255),   // Bright Blue
        13 => (255, 0, 255),   // Bright Magenta
        14 => (0, 255, 255),   // Bright Cyan
        15 => (255, 255, 255), // Bright White
        // 216 color cube (16-231): 6x6x6
        16..=231 => {
            let i = index - 16;
            let r = (i / 36) % 6;
            let g = (i / 6) % 6;
            let b = i % 6;
            let to_val = |v: u8| if v == 0 { 0 } else { 55 + v * 40 };
            (to_val(r), to_val(g), to_val(b))
        }
        // Grayscale (232-255): 24 shades
        232..=255 => {
            let gray = 8 + (index - 232) * 10;
            (gray, gray, gray)
        }
    }
}

/// Virtual terminal that properly handles ANSI escape sequences.
/// Uses the optimized Grid structure internally for efficient storage and scrolling.
#[derive(Debug, Clone)]
pub struct VirtualTerminal {
    /// Optimized grid structure with tripartite design
    pub(crate) internal_grid: Grid,
    /// Maximum scrollback lines
    pub max_scrollback: usize,
    /// Saved cursor position and style
    saved_cursor: Option<SavedCursor>,
    /// Cursor visible
    pub cursor_visible: bool,
    /// Cursor blink enabled
    pub cursor_blink: bool,
    /// Insert mode (IRM) - when true, characters shift right instead of overwriting
    insert_mode: bool,
    /// Alternate screen buffer
    alternate_screen: Option<Box<AlternateScreen>>,
    /// Origin mode (DECOM) - cursor positioning relative to scroll region
    origin_mode: bool,
    /// Auto-wrap mode (DECAWM)
    auto_wrap: bool,
    /// Pending wrap - cursor is at the edge and next char will wrap
    pending_wrap: bool,
    /// Tab stops (columns where tabs stop)
    tab_stops: Vec<usize>,
    /// Current charset (0 = G0, 1 = G1)
    charset_index: usize,
    /// G0 charset mode (false = normal, true = line drawing)
    g0_charset_line_drawing: bool,
    /// G1 charset mode (false = normal, true = line drawing)
    g1_charset_line_drawing: bool,
    /// Application cursor keys mode (affects arrow key output)
    pub application_cursor_keys: bool,
    /// Application keypad mode (affects numpad output)
    pub application_keypad: bool,
    /// Bracketed paste mode
    pub bracketed_paste: bool,
    /// Mouse tracking mode (1000=X10, 1002=button-event, 1003=any-event)
    pub mouse_tracking: Option<u16>,
    /// SGR extended mouse mode (1006) - affects encoding of mouse events
    pub sgr_mouse_mode: bool,
    /// Bell triggered flag (for UI notification)
    pub bell_pending: bool,
    /// Window title (set via OSC)
    pub title: Option<String>,
    /// Last printed character (for REP - repeat)
    last_printed_char: Option<char>,
    /// Pending responses to send back to the PTY (e.g., DSR cursor position report)
    pub pending_responses: Vec<Vec<u8>>,
    /// Default foreground color (OSC 10) - None means use terminal's native color
    pub default_fg_color: Option<(u8, u8, u8)>,
    /// Default background color (OSC 11) - None means use terminal's native color
    pub default_bg_color: Option<(u8, u8, u8)>,
    /// Cursor color (OSC 12) - None means use terminal's native cursor color
    pub cursor_color: Option<(u8, u8, u8)>,
    /// 256-color palette (OSC 4) - stores custom colors, None means use default
    color_palette: [Option<(u8, u8, u8)>; 256],
    /// Flag to signal alt screen was entered/exited (for UI to reset scroll state)
    pub alt_screen_toggled: bool,
    /// DECLRMM - Left/Right Margin Mode (mode 69)
    /// When enabled, DECSLRM can set left/right margins with CSI Pl ; Pr s
    pub enable_left_right_margins: bool,
    /// Reverse wraparound mode (mode 45) - allows BS to wrap to previous line
    pub reverse_wraparound: bool,
    /// LNM - Line Feed/New Line Mode (ANSI mode 20)
    /// When set, LF/VT/FF also perform CR (carriage return)
    newline_mode: bool,
    /// Cursor style (DECSCUSR) - 0=default, 1=blinking block, 2=steady block,
    /// 3=blinking underline, 4=steady underline, 5=blinking bar, 6=steady bar
    cursor_style: u8,
    /// DCS handler state - tracks what type of DCS sequence we're processing
    dcs_handler: DcsHandler,
    /// DCS data buffer - accumulates bytes during DCS sequence
    dcs_data: Vec<u8>,
}

/// DCS handler state for Device Control String sequences
#[derive(Debug, Clone, Default)]
enum DcsHandler {
    #[default]
    None,
    /// DECRQSS - Request Status String (DCS $ q Pt ST)
    Decrqss,
}

/// Saved cursor state (DECSC/DECRC)
#[derive(Debug, Clone)]
struct SavedCursor {
    row: usize,
    col: usize,
    styles: CharacterStyles,
    origin_mode: bool,
    auto_wrap: bool,
    charset_index: usize,
    g0_charset_line_drawing: bool,
    g1_charset_line_drawing: bool,
}

/// Saved state for alternate screen buffer
#[derive(Debug, Clone)]
struct AlternateScreen {
    grid: Grid,
    cursor_row: usize,
    cursor_col: usize,
    current_styles: CharacterStyles,
    // Terminal modes that affect cursor positioning (per xterm behavior)
    origin_mode: bool,
    auto_wrap: bool,
    pending_wrap: bool,
    // Cursor visibility modes (per-screen state)
    cursor_visible: bool,
    cursor_blink: bool,
    // Charset state
    charset_index: usize,
    g0_charset_line_drawing: bool,
    g1_charset_line_drawing: bool,
}

impl VirtualTerminal {
    pub fn new(rows: usize, cols: usize) -> Self {
        // Initialize default tab stops every 8 columns
        let tab_stops: Vec<usize> = (0..cols).filter(|&c| c % 8 == 0 && c > 0).collect();
        Self {
            internal_grid: Grid::new(rows, cols),
            max_scrollback: 10000,
            saved_cursor: None,
            cursor_visible: true,
            cursor_blink: true,
            insert_mode: false,
            alternate_screen: None,
            origin_mode: false,
            auto_wrap: true,
            pending_wrap: false,
            tab_stops,
            charset_index: 0,
            g0_charset_line_drawing: false,
            g1_charset_line_drawing: false,
            application_cursor_keys: false,
            application_keypad: false,
            bracketed_paste: false,
            mouse_tracking: None,
            sgr_mouse_mode: false,
            bell_pending: false,
            title: None,
            last_printed_char: None,
            pending_responses: Vec::new(),
            default_fg_color: None,     // Use terminal's native color
            default_bg_color: None,     // Use terminal's native color
            cursor_color: None,         // Use terminal's native cursor color
            color_palette: [None; 256], // Use default 256-color palette
            alt_screen_toggled: false,
            enable_left_right_margins: false,
            reverse_wraparound: false,
            newline_mode: true, // LNM mode 20 - set by default in xterm
            cursor_style: 0,    // Default cursor style (blinking block)
            dcs_handler: DcsHandler::None,
            dcs_data: Vec::new(),
        }
    }

    // ===== Property accessors for backward compatibility =====

    /// Get number of rows
    #[inline]
    pub fn rows(&self) -> usize {
        self.internal_grid.rows
    }

    /// Get number of columns
    #[inline]
    pub fn cols(&self) -> usize {
        self.internal_grid.cols
    }

    /// Get cursor row
    #[inline]
    pub fn cursor_row(&self) -> usize {
        self.internal_grid.cursor_row
    }

    /// Get cursor column
    #[inline]
    pub fn cursor_col(&self) -> usize {
        self.internal_grid.cursor_col
    }

    /// Set cursor row
    #[inline]
    pub fn set_cursor_row(&mut self, row: usize) {
        self.internal_grid.cursor_row = row;
    }

    /// Set cursor column
    #[inline]
    pub fn set_cursor_col(&mut self, col: usize) {
        self.internal_grid.cursor_col = col;
    }

    /// Get scroll region
    #[inline]
    pub fn scroll_region(&self) -> (usize, usize) {
        self.internal_grid.scroll_region
    }

    /// Get current style as ratatui Style
    pub fn current_style(&self) -> Style {
        self.internal_grid.current_styles.to_ratatui_style()
    }

    /// Get the RGB color for a palette index, considering custom OSC 4 colors.
    /// Returns the custom color if set, otherwise the default palette color.
    pub fn get_palette_color(&self, index: u8) -> (u8, u8, u8) {
        self.color_palette[index as usize].unwrap_or_else(|| default_palette_color(index))
    }

    /// Get a reference to the full color palette for rendering.
    /// Returns an array of Option<(u8, u8, u8)> where Some = custom color, None = use default.
    pub fn color_palette(&self) -> &crate::ColorPalette {
        &self.color_palette
    }

    /// Get scrollback length
    pub fn scrollback_len(&self) -> usize {
        self.internal_grid.scrollback_len()
    }

    // ===== Legacy grid accessor (for tests) =====

    /// Provides legacy Vec<Vec<Cell>> like access for backward compatibility.
    /// Returns a Cell at the given position.
    pub fn get_cell(&self, row: usize, col: usize) -> Cell {
        if let Some(tc) = self.internal_grid.get_char(row, col) {
            Cell::from(tc)
        } else {
            Cell::default()
        }
    }

    // ===== Public field accessors for backward compatibility with tests =====

    /// Legacy grid accessor - returns a view that can be indexed like Vec<Vec<Cell>>
    /// WARNING: This allocates! Use get_cell() for single cell access.
    pub fn grid_snapshot(&self) -> Vec<Vec<Cell>> {
        self.internal_grid
            .viewport
            .iter()
            .map(|row| row.columns.iter().map(Cell::from).collect())
            .collect()
    }

    /// Legacy scrollback accessor
    /// WARNING: This allocates!
    pub fn scrollback_snapshot(&self) -> Vec<Vec<Cell>> {
        self.internal_grid
            .lines_above
            .iter()
            .map(|row| row.columns.iter().map(Cell::from).collect())
            .collect()
    }

    // ===== Tab stop methods =====

    /// Initialize default tab stops (every 8 columns)
    #[allow(dead_code)]
    fn reset_tab_stops(&mut self) {
        self.tab_stops = (0..self.internal_grid.cols)
            .filter(|&c| c % 8 == 0 && c > 0)
            .collect();
    }

    /// Clear all tab stops
    fn clear_all_tab_stops(&mut self) {
        self.tab_stops.clear();
    }

    /// Clear tab stop at current column
    fn clear_tab_stop_at_cursor(&mut self) {
        self.tab_stops
            .retain(|&c| c != self.internal_grid.cursor_col);
    }

    /// Set tab stop at current column
    fn set_tab_stop_at_cursor(&mut self) {
        if !self.tab_stops.contains(&self.internal_grid.cursor_col) {
            self.tab_stops.push(self.internal_grid.cursor_col);
            self.tab_stops.sort();
        }
    }

    /// Move cursor to next tab stop
    fn tab_forward(&mut self) {
        if let Some(&next_tab) = self
            .tab_stops
            .iter()
            .find(|&&c| c > self.internal_grid.cursor_col)
        {
            self.internal_grid.cursor_col = next_tab.min(self.internal_grid.cols - 1);
        } else {
            // No more tab stops, go to end of line
            self.internal_grid.cursor_col = self.internal_grid.cols - 1;
        }
        self.pending_wrap = false;
    }

    /// Move cursor to previous tab stop (CBT)
    fn tab_backward(&mut self, n: usize) {
        for _ in 0..n {
            if let Some(&prev_tab) = self
                .tab_stops
                .iter()
                .rev()
                .find(|&&c| c < self.internal_grid.cursor_col)
            {
                self.internal_grid.cursor_col = prev_tab;
            } else {
                self.internal_grid.cursor_col = 0;
            }
        }
        self.pending_wrap = false;
    }

    /// Save cursor position and attributes (DECSC)
    fn save_cursor(&mut self) {
        self.saved_cursor = Some(SavedCursor {
            row: self.internal_grid.cursor_row,
            col: self.internal_grid.cursor_col,
            styles: self.internal_grid.current_styles,
            origin_mode: self.origin_mode,
            auto_wrap: self.auto_wrap,
            charset_index: self.charset_index,
            g0_charset_line_drawing: self.g0_charset_line_drawing,
            g1_charset_line_drawing: self.g1_charset_line_drawing,
        });
    }

    /// Restore cursor position and attributes (DECRC)
    fn restore_cursor(&mut self) {
        if let Some(saved) = &self.saved_cursor {
            self.internal_grid.cursor_row =
                saved.row.min(self.internal_grid.rows.saturating_sub(1));
            self.internal_grid.cursor_col =
                saved.col.min(self.internal_grid.cols.saturating_sub(1));
            self.internal_grid.set_current_styles(saved.styles);
            self.origin_mode = saved.origin_mode;
            self.auto_wrap = saved.auto_wrap;
            self.charset_index = saved.charset_index;
            self.g0_charset_line_drawing = saved.g0_charset_line_drawing;
            self.g1_charset_line_drawing = saved.g1_charset_line_drawing;
        }
        self.pending_wrap = false;
    }

    /// Soft Terminal Reset (DECSTR) - CSI ! p
    /// Resets modes to defaults without clearing screen or scrollback
    fn soft_reset(&mut self) {
        // Reset text attributes (SGR)
        self.internal_grid
            .set_current_styles(CharacterStyles::default());

        // Reset insert mode
        self.insert_mode = false;

        // Reset origin mode
        self.origin_mode = false;

        // Reset auto-wrap mode (default is on)
        self.auto_wrap = true;

        // Reset cursor visibility (default is visible)
        self.cursor_visible = true;

        // Reset cursor blink (default is on)
        self.cursor_blink = true;

        // Reset scroll region to full screen
        self.internal_grid.scroll_region = (0, self.internal_grid.rows.saturating_sub(1));

        // Reset saved cursor
        self.saved_cursor = None;

        // Reset pending wrap state
        self.pending_wrap = false;

        // Reset charset to G0 and clear line drawing modes
        self.charset_index = 0;
        self.g0_charset_line_drawing = false;
        self.g1_charset_line_drawing = false;

        // Reset tab stops to default (every 8 columns)
        self.tab_stops = (0..self.internal_grid.cols)
            .filter(|&c| c % 8 == 0 && c > 0)
            .collect();
    }

    /// Resize the terminal
    pub fn resize(&mut self, new_rows: usize, new_cols: usize) {
        self.internal_grid.resize(new_rows, new_cols);
        // Update tab stops for new width
        self.tab_stops.retain(|&c| c < new_cols);
        self.internal_grid.fix_cursor_on_spacer();
    }

    /// Process raw terminal data
    pub fn process(&mut self, data: &[u8]) {
        let mut parser = Parser::new();
        for byte in data {
            parser.advance(self, *byte);
        }
    }

    /// Drain pending responses that should be sent back to the PTY
    pub fn drain_responses(&mut self) -> Vec<Vec<u8>> {
        std::mem::take(&mut self.pending_responses)
    }

    /// Get the current viewport content as plain text lines.
    /// Each line is trimmed of trailing spaces.
    pub fn viewport_lines(&self) -> Vec<String> {
        let snapshot = self.grid_snapshot();
        snapshot
            .into_iter()
            .map(|row| {
                let line: String = row.iter().map(|cell| cell.c).collect();
                line.trim_end().to_string()
            })
            .collect()
    }

    /// Get all content including scrollback as plain text lines.
    /// Scrollback lines come first, then viewport lines.
    pub fn get_lines(&self) -> Vec<String> {
        let mut lines = Vec::new();

        // Add scrollback
        for row in self.scrollback_snapshot() {
            let line: String = row.iter().map(|cell| cell.c).collect();
            lines.push(line.trim_end().to_string());
        }

        // Add viewport
        lines.extend(self.viewport_lines());

        lines
    }

    /// Scroll the screen up by one line within the scroll region
    fn scroll_up(&mut self) {
        self.internal_grid.scroll_up_in_region(1);
    }

    /// Scroll the screen down by one line within the scroll region
    fn scroll_down(&mut self) {
        self.internal_grid.scroll_down_in_region(1);
    }

    /// Move cursor to new line, scrolling if necessary
    fn newline(&mut self) {
        self.internal_grid.newline();
    }

    /// Carriage return - move cursor to beginning of line
    fn carriage_return(&mut self) {
        self.internal_grid.cursor_col = 0;
    }

    /// Put a character at cursor position and advance
    fn put_char(&mut self, c: char) {
        // Handle pending wrap from previous character at edge
        if self.pending_wrap {
            self.pending_wrap = false;
            self.internal_grid.cursor_col = 0;
            self.newline();
        }

        // Apply line drawing character set if active
        let display_char = if self.is_line_drawing_active() {
            line_drawing_char(c)
        } else {
            c
        };

        // Save for REP (repeat character) command
        self.last_printed_char = Some(display_char);

        // Create the terminal character
        let character =
            TerminalCharacter::new(display_char, self.internal_grid.current_shared_styles());
        let char_width = character.width();

        // Handle zero-width characters (combining chars, etc.) - just skip them for now
        if char_width == 0 {
            return;
        }

        // For wide characters, check if we have room for both cells
        if char_width == 2 && self.internal_grid.cursor_col + 1 >= self.internal_grid.cols {
            if self.auto_wrap {
                // Clear the current cell (it would be orphaned) and wrap
                self.internal_grid.set_char(
                    self.internal_grid.cursor_row,
                    self.internal_grid.cursor_col,
                    TerminalCharacter::default(),
                );
                self.internal_grid.cursor_col = 0;
                self.newline();
            } else {
                // Can't fit, don't print
                return;
            }
        }

        let cursor_row = self.internal_grid.cursor_row;
        let cursor_col = self.internal_grid.cursor_col;
        let cols = self.internal_grid.cols;

        // Defensive bounds check
        if cursor_row < self.internal_grid.rows && cursor_col < cols {
            // In insert mode, shift characters right
            if self.insert_mode {
                self.internal_grid.insert_chars(char_width);
            }

            // Handle overwriting wide character spacer
            if let Some(existing) = self.internal_grid.get_char(cursor_row, cursor_col) {
                if existing.wide_spacer && cursor_col > 0 {
                    self.internal_grid.set_char(
                        cursor_row,
                        cursor_col - 1,
                        TerminalCharacter::default(),
                    );
                }
            }

            // Handle overwriting a wide character's first cell with a narrow character
            if char_width == 1 && cursor_col + 1 < cols {
                if let Some(next) = self.internal_grid.get_char(cursor_row, cursor_col + 1) {
                    if next.wide_spacer {
                        self.internal_grid.set_char(
                            cursor_row,
                            cursor_col + 1,
                            TerminalCharacter::default(),
                        );
                    }
                }
            }

            // Place the character
            self.internal_grid
                .set_char(cursor_row, cursor_col, character);

            // For wide characters, place a spacer in the next cell
            if char_width == 2 && cursor_col + 1 < cols {
                // Check if next cell would overwrite another wide char
                if cursor_col + 2 < cols {
                    if let Some(next_next) = self.internal_grid.get_char(cursor_row, cursor_col + 2)
                    {
                        if next_next.wide_spacer {
                            self.internal_grid.set_char(
                                cursor_row,
                                cursor_col + 2,
                                TerminalCharacter::default(),
                            );
                        }
                    }
                }
                self.internal_grid.set_char(
                    cursor_row,
                    cursor_col + 1,
                    TerminalCharacter::wide_spacer(self.internal_grid.current_shared_styles()),
                );
            }

            // Advance cursor
            if cursor_col + char_width >= cols {
                // At the edge - set pending wrap if auto-wrap is enabled
                if self.auto_wrap {
                    self.pending_wrap = true;
                }
                self.internal_grid.cursor_col = cols - 1;
            } else {
                self.internal_grid.cursor_col += char_width;
            }
        }
    }

    /// Check if line drawing character set is active
    fn is_line_drawing_active(&self) -> bool {
        if self.charset_index == 0 {
            self.g0_charset_line_drawing
        } else {
            self.g1_charset_line_drawing
        }
    }

    /// Repeat the last printed character n times
    fn repeat_char(&mut self, n: usize) {
        if let Some(c) = self.last_printed_char {
            for _ in 0..n {
                // Temporarily disable line drawing since character is already translated
                let old_g0 = self.g0_charset_line_drawing;
                let old_g1 = self.g1_charset_line_drawing;
                self.g0_charset_line_drawing = false;
                self.g1_charset_line_drawing = false;
                self.put_char(c);
                self.g0_charset_line_drawing = old_g0;
                self.g1_charset_line_drawing = old_g1;
            }
        }
    }

    /// Insert n blank characters at cursor position, shifting existing chars right
    fn insert_chars(&mut self, n: usize) {
        self.internal_grid.insert_chars(n);
    }

    /// Clear from cursor to end of line
    fn clear_to_end_of_line(&mut self) {
        self.internal_grid.clear_to_end_of_line();
    }

    /// Clear from cursor to beginning of line
    fn clear_to_start_of_line(&mut self) {
        self.internal_grid.clear_to_start_of_line();
    }

    /// Clear entire line
    fn clear_line(&mut self) {
        self.internal_grid.clear_line();
    }

    /// Clear from cursor to end of screen
    fn clear_to_end_of_screen(&mut self) {
        self.internal_grid.clear_to_end_of_screen();
    }

    /// Clear from cursor to beginning of screen
    fn clear_to_start_of_screen(&mut self) {
        self.internal_grid.clear_to_start_of_screen();
    }

    /// Clear entire screen
    fn clear_screen(&mut self) {
        self.internal_grid.clear_screen();
    }

    /// Calculate checksum of characters in a rectangular area (for DECRQCRA)
    /// Coordinates are 1-based, inclusive
    /// Returns the NEGATED checksum to match old xterm behavior (pre-patch 279)
    /// esctest expects this format when --expected-terminal=xterm is used
    fn calculate_rect_checksum(&self, top: usize, left: usize, bottom: usize, right: usize) -> u16 {
        let mut checksum: u16 = 0;

        // Convert to 0-based indices and clamp to grid bounds
        let top_idx = top
            .saturating_sub(1)
            .min(self.internal_grid.rows.saturating_sub(1));
        let left_idx = left
            .saturating_sub(1)
            .min(self.internal_grid.cols.saturating_sub(1));
        let bottom_idx = bottom
            .saturating_sub(1)
            .min(self.internal_grid.rows.saturating_sub(1));
        let right_idx = right
            .saturating_sub(1)
            .min(self.internal_grid.cols.saturating_sub(1));

        for row in top_idx..=bottom_idx {
            for col in left_idx..=right_idx {
                let ch = self
                    .internal_grid
                    .get_char(row, col)
                    .map(|tc| tc.char())
                    .unwrap_or(' ');
                // Add character value to checksum (wrapping add)
                checksum = checksum.wrapping_add(ch as u16);
            }
        }

        // Return negated checksum (old xterm behavior)
        // esctest with xterm_checksum < 279 will negate this back to get the correct value
        checksum.wrapping_neg()
    }

    /// Handle DECRQSS (Request Status String) response
    /// Request: DCS $ q Pt ST (where Pt is the selector string)
    /// Response: DCS P $ r D... ST (P=1 valid, 0 invalid, D is the current setting)
    fn handle_decrqss(&mut self) {
        let selector = String::from_utf8_lossy(&self.dcs_data);
        let selector = selector.as_ref();

        // Response format: DCS 1 $ r <value><selector> ST (valid)
        //                  DCS 0 $ r ST (invalid)
        let response = match selector {
            // DECSTBM - Set Top and Bottom Margins
            "r" => {
                let (top, bottom) = self.internal_grid.scroll_region;
                // Margins are 1-based in the response
                format!("\x1bP1$r{};{}r\x1b\\", top + 1, bottom + 1)
            }
            // DECSLRM - Set Left and Right Margins
            "s" => {
                if self.enable_left_right_margins {
                    let left = self.internal_grid.left_margin + 1;
                    let right = self.internal_grid.right_margin + 1;
                    format!("\x1bP1$r{};{}s\x1b\\", left, right)
                } else {
                    // When DECLRMM is off, report full width
                    format!("\x1bP1$r1;{}s\x1b\\", self.internal_grid.cols)
                }
            }
            // SGR - Select Graphic Rendition
            "m" => {
                let sgr = self.get_sgr_string();
                format!("\x1bP1$r{}m\x1b\\", sgr)
            }
            // DECSCUSR - Set Cursor Style (space + q)
            " q" => {
                format!("\x1bP1$r{} q\x1b\\", self.cursor_style)
            }
            // DECSLPP - Set Lines Per Page (t)
            "t" => {
                format!("\x1bP1$r{}t\x1b\\", self.internal_grid.rows)
            }
            // DECSNLS - Set Number of Lines per Screen (*|)
            "*|" => {
                format!("\x1bP1$r{}*|\x1b\\", self.internal_grid.rows)
            }
            // DECSSDT - Select Status Display Type ($~)
            "$~" => {
                // We don't support status line, report 0 (no status line)
                "\x1bP1$r0$~\x1b\\".to_string()
            }
            // DECSASD - Select Active Status Display ($})
            "$}" => {
                // We don't support status line, report 0 (main display)
                "\x1bP1$r0$}\x1b\\".to_string()
            }
            // DECSACE - Select Attribute Change Extent (*x)
            "*x" => {
                // Report 0 (stream extent - default)
                "\x1bP1$r0*x\x1b\\".to_string()
            }
            // DECSCA - Set Character Attribute ("q)
            "\"q" => {
                // We don't track protected attributes, report 0 (not protected)
                "\x1bP1$r0\"q\x1b\\".to_string()
            }
            // DECSCL - Set Conformance Level ("p)
            "\"p" => {
                // Report VT400 level (64) with 7-bit controls (1)
                "\x1bP1$r64;1\"p\x1b\\".to_string()
            }
            // Unknown selector - return invalid response
            _ => "\x1bP0$r\x1b\\".to_string(),
        };

        self.pending_responses.push(response.into_bytes());
    }

    /// Generate SGR parameter string for current attributes
    fn get_sgr_string(&self) -> String {
        let styles = &self.internal_grid.current_styles;
        let mut params = vec!["0".to_string()]; // Always start with reset

        if styles.modifiers.contains(Modifier::BOLD) {
            params.push("1".to_string());
        }
        if styles.modifiers.contains(Modifier::DIM) {
            params.push("2".to_string());
        }
        if styles.modifiers.contains(Modifier::ITALIC) {
            params.push("3".to_string());
        }
        if styles.modifiers.contains(Modifier::UNDERLINED) {
            params.push("4".to_string());
        }
        if styles.modifiers.contains(Modifier::SLOW_BLINK) {
            params.push("5".to_string());
        }
        if styles.modifiers.contains(Modifier::REVERSED) {
            params.push("7".to_string());
        }
        if styles.modifiers.contains(Modifier::HIDDEN) {
            params.push("8".to_string());
        }
        if styles.modifiers.contains(Modifier::CROSSED_OUT) {
            params.push("9".to_string());
        }

        // Foreground color
        if let Some(color) = &styles.foreground {
            self.color_to_sgr_params(color, 30, 90, 38, &mut params);
        }

        // Background color
        if let Some(color) = &styles.background {
            self.color_to_sgr_params(color, 40, 100, 48, &mut params);
        }

        params.join(";")
    }

    /// Convert a ratatui Color to SGR parameters
    fn color_to_sgr_params(
        &self,
        color: &Color,
        base: u8,
        bright_base: u8,
        extended: u8,
        params: &mut Vec<String>,
    ) {
        match color {
            Color::Black => params.push(format!("{}", base)),
            Color::Red => params.push(format!("{}", base + 1)),
            Color::Green => params.push(format!("{}", base + 2)),
            Color::Yellow => params.push(format!("{}", base + 3)),
            Color::Blue => params.push(format!("{}", base + 4)),
            Color::Magenta => params.push(format!("{}", base + 5)),
            Color::Cyan => params.push(format!("{}", base + 6)),
            Color::White | Color::Gray => params.push(format!("{}", base + 7)),
            Color::DarkGray => params.push(format!("{}", bright_base)),
            Color::LightRed => params.push(format!("{}", bright_base + 1)),
            Color::LightGreen => params.push(format!("{}", bright_base + 2)),
            Color::LightYellow => params.push(format!("{}", bright_base + 3)),
            Color::LightBlue => params.push(format!("{}", bright_base + 4)),
            Color::LightMagenta => params.push(format!("{}", bright_base + 5)),
            Color::LightCyan => params.push(format!("{}", bright_base + 6)),
            Color::Indexed(n) => {
                if *n < 8 {
                    params.push(format!("{}", base + n));
                } else if *n < 16 {
                    params.push(format!("{}", bright_base + n - 8));
                } else {
                    params.push(format!("{};5;{}", extended, n));
                }
            }
            Color::Rgb(r, g, b) => {
                params.push(format!("{};2;{};{};{}", extended, r, g, b));
            }
            Color::Reset => {} // Reset is handled by the leading "0"
        }
    }

    /// Get visible lines for rendering (including scrollback)
    pub fn visible_lines(&self, height: usize, scroll_offset: usize) -> Vec<&Row> {
        self.internal_grid
            .visible_lines(scroll_offset)
            .into_iter()
            .take(height)
            .collect()
    }

    /// Scroll view up (into history)
    pub fn scroll_view_up(&mut self, n: usize) -> usize {
        self.internal_grid.scroll_view_up(n)
    }

    /// Parse SGR (Select Graphic Rendition) parameters
    /// Handles both semicolon-separated (38;2;r;g;b) and colon-separated (38:2:r:g:b) formats
    fn apply_sgr(&mut self, params: &Params) {
        // Collect params, preserving subparameters for extended color handling
        let raw_params: Vec<&[u16]> = params.iter().collect();

        if raw_params.is_empty() {
            self.internal_grid
                .set_current_styles(CharacterStyles::default());
            return;
        }

        let mut styles = self.internal_grid.current_styles;
        let mut i = 0;
        while i < raw_params.len() {
            let param = raw_params[i];
            let code = param[0];

            match code {
                0 => styles = CharacterStyles::default(),
                1 => styles = styles.add_modifier(Modifier::BOLD),
                2 => styles = styles.add_modifier(Modifier::DIM),
                3 => styles = styles.add_modifier(Modifier::ITALIC),
                4 => styles = styles.add_modifier(Modifier::UNDERLINED),
                5 | 6 => styles = styles.add_modifier(Modifier::SLOW_BLINK),
                7 => styles = styles.add_modifier(Modifier::REVERSED),
                8 => styles = styles.add_modifier(Modifier::HIDDEN),
                9 => styles = styles.add_modifier(Modifier::CROSSED_OUT),
                22 => styles = styles.remove_modifier(Modifier::BOLD | Modifier::DIM),
                23 => styles = styles.remove_modifier(Modifier::ITALIC),
                24 => styles = styles.remove_modifier(Modifier::UNDERLINED),
                25 => styles = styles.remove_modifier(Modifier::SLOW_BLINK),
                27 => styles = styles.remove_modifier(Modifier::REVERSED),
                28 => styles = styles.remove_modifier(Modifier::HIDDEN),
                29 => styles = styles.remove_modifier(Modifier::CROSSED_OUT),
                // Foreground colors
                30 => styles = styles.fg(Color::Black),
                31 => styles = styles.fg(Color::Red),
                32 => styles = styles.fg(Color::Green),
                33 => styles = styles.fg(Color::Yellow),
                34 => styles = styles.fg(Color::Blue),
                35 => styles = styles.fg(Color::Magenta),
                36 => styles = styles.fg(Color::Cyan),
                37 => styles = styles.fg(Color::Gray),
                38 => {
                    // Extended foreground color
                    // Check for colon-separated subparameters first (38:2:r:g:b or 38:5:n)
                    if param.len() >= 3 && param[1] == 5 {
                        // 256 color mode with subparameters: 38:5:n
                        styles = styles.fg(Color::Indexed(param[2] as u8));
                    } else if param.len() >= 5 && param[1] == 2 {
                        // RGB color mode with subparameters: 38:2:r:g:b
                        // Note: Some terminals use 38:2:colorspace:r:g:b (6 params)
                        let (r, g, b) = if param.len() >= 6 {
                            // 38:2:colorspace:r:g:b format
                            (param[3] as u8, param[4] as u8, param[5] as u8)
                        } else {
                            // 38:2:r:g:b format
                            (param[2] as u8, param[3] as u8, param[4] as u8)
                        };
                        styles = styles.fg(Color::Rgb(r, g, b));
                    } else if i + 2 < raw_params.len() && raw_params[i + 1][0] == 5 {
                        // Semicolon-separated 256 color: 38;5;n
                        styles = styles.fg(Color::Indexed(raw_params[i + 2][0] as u8));
                        i += 2;
                    } else if i + 4 < raw_params.len() && raw_params[i + 1][0] == 2 {
                        // Semicolon-separated RGB: 38;2;r;g;b
                        styles = styles.fg(Color::Rgb(
                            raw_params[i + 2][0] as u8,
                            raw_params[i + 3][0] as u8,
                            raw_params[i + 4][0] as u8,
                        ));
                        i += 4;
                    }
                }
                39 => styles.foreground = None,
                // Background colors
                40 => styles = styles.bg(Color::Black),
                41 => styles = styles.bg(Color::Red),
                42 => styles = styles.bg(Color::Green),
                43 => styles = styles.bg(Color::Yellow),
                44 => styles = styles.bg(Color::Blue),
                45 => styles = styles.bg(Color::Magenta),
                46 => styles = styles.bg(Color::Cyan),
                47 => styles = styles.bg(Color::Gray),
                48 => {
                    // Extended background color
                    // Check for colon-separated subparameters first (48:2:r:g:b or 48:5:n)
                    if param.len() >= 3 && param[1] == 5 {
                        // 256 color mode with subparameters: 48:5:n
                        styles = styles.bg(Color::Indexed(param[2] as u8));
                    } else if param.len() >= 5 && param[1] == 2 {
                        // RGB color mode with subparameters: 48:2:r:g:b
                        // Note: Some terminals use 48:2:colorspace:r:g:b (6 params)
                        let (r, g, b) = if param.len() >= 6 {
                            // 48:2:colorspace:r:g:b format
                            (param[3] as u8, param[4] as u8, param[5] as u8)
                        } else {
                            // 48:2:r:g:b format
                            (param[2] as u8, param[3] as u8, param[4] as u8)
                        };
                        styles = styles.bg(Color::Rgb(r, g, b));
                    } else if i + 2 < raw_params.len() && raw_params[i + 1][0] == 5 {
                        // Semicolon-separated 256 color: 48;5;n
                        styles = styles.bg(Color::Indexed(raw_params[i + 2][0] as u8));
                        i += 2;
                    } else if i + 4 < raw_params.len() && raw_params[i + 1][0] == 2 {
                        // Semicolon-separated RGB: 48;2;r;g;b
                        styles = styles.bg(Color::Rgb(
                            raw_params[i + 2][0] as u8,
                            raw_params[i + 3][0] as u8,
                            raw_params[i + 4][0] as u8,
                        ));
                        i += 4;
                    }
                }
                49 => styles.background = None,
                // Bright foreground colors
                90 => styles = styles.fg(Color::DarkGray),
                91 => styles = styles.fg(Color::LightRed),
                92 => styles = styles.fg(Color::LightGreen),
                93 => styles = styles.fg(Color::LightYellow),
                94 => styles = styles.fg(Color::LightBlue),
                95 => styles = styles.fg(Color::LightMagenta),
                96 => styles = styles.fg(Color::LightCyan),
                97 => styles = styles.fg(Color::Indexed(15)), // Bright white
                // Bright background colors
                100 => styles = styles.bg(Color::DarkGray),
                101 => styles = styles.bg(Color::LightRed),
                102 => styles = styles.bg(Color::LightGreen),
                103 => styles = styles.bg(Color::LightYellow),
                104 => styles = styles.bg(Color::LightBlue),
                105 => styles = styles.bg(Color::LightMagenta),
                106 => styles = styles.bg(Color::LightCyan),
                107 => styles = styles.bg(Color::Indexed(15)), // Bright white
                _ => {}
            }
            i += 1;
        }
        self.internal_grid.set_current_styles(styles);
    }
}

impl Perform for VirtualTerminal {
    fn print(&mut self, c: char) {
        self.put_char(c);
    }

    fn execute(&mut self, byte: u8) {
        match byte {
            // Bell
            0x07 => {
                self.bell_pending = true;
            }
            // Backspace
            0x08 => {
                // Determine left boundary
                let left_margin = if self.enable_left_right_margins {
                    self.internal_grid.left_margin
                } else {
                    0
                };

                if self.pending_wrap {
                    // If we have a pending wrap, just clear it (cursor stays at right edge)
                    self.pending_wrap = false;
                } else if self.internal_grid.cursor_col > left_margin {
                    // Normal case: move cursor left
                    self.internal_grid.cursor_col -= 1;
                } else if self.reverse_wraparound && self.auto_wrap {
                    // Reverse wraparound: wrap to previous line's right edge
                    let right_margin = if self.enable_left_right_margins {
                        self.internal_grid.right_margin
                    } else {
                        self.internal_grid.cols - 1
                    };

                    // Determine top boundary
                    let (top, _) = self.internal_grid.scroll_region;

                    if self.internal_grid.cursor_row > top {
                        // Move to previous line's right edge
                        self.internal_grid.cursor_row -= 1;
                        self.internal_grid.cursor_col = right_margin;
                    }
                    // If at top of scroll region, cursor stays at left margin
                }
                // If at left margin without reverse wraparound, cursor stays put
            }
            // Tab
            0x09 => {
                self.tab_forward();
            }
            // Line feed, vertical tab, form feed
            0x0A..=0x0C => {
                self.newline();
                self.carriage_return();
            }
            // Carriage return
            0x0D => {
                self.carriage_return();
                self.pending_wrap = false;
            }
            // Shift Out - switch to G1 charset
            0x0E => {
                self.charset_index = 1;
            }
            // Shift In - switch to G0 charset
            0x0F => {
                self.charset_index = 0;
            }
            _ => {}
        }
    }

    fn hook(&mut self, _params: &Params, intermediates: &[u8], _ignore: bool, action: char) {
        // DECRQSS - Request Status String (DCS $ q Pt ST)
        if intermediates.contains(&b'$') && action == 'q' {
            self.dcs_handler = DcsHandler::Decrqss;
            self.dcs_data.clear();
        } else {
            self.dcs_handler = DcsHandler::None;
        }
    }

    fn put(&mut self, byte: u8) {
        // Accumulate bytes during DCS sequence
        if !matches!(self.dcs_handler, DcsHandler::None) {
            self.dcs_data.push(byte);
        }
    }

    fn unhook(&mut self) {
        match self.dcs_handler {
            DcsHandler::Decrqss => {
                self.handle_decrqss();
            }
            DcsHandler::None => {}
        }
        self.dcs_handler = DcsHandler::None;
        self.dcs_data.clear();
    }

    fn osc_dispatch(&mut self, params: &[&[u8]], _bell_terminated: bool) {
        if params.is_empty() {
            return;
        }

        let cmd = params[0];
        if let Ok(cmd_str) = std::str::from_utf8(cmd) {
            match cmd_str {
                // Window title (OSC 0 and OSC 2)
                "0" | "2" => {
                    if params.len() > 1 {
                        if let Ok(title) = std::str::from_utf8(params[1]) {
                            self.title = Some(title.to_string());
                        }
                    }
                }
                // OSC 4 - Query/Set indexed color (256-color palette)
                // Format: OSC 4 ; index ; colorspec ST or OSC 4 ; index ; ? ST
                "4" => {
                    // Process pairs of (index, colorspec) from params[1..]
                    let mut i = 1;
                    while i + 1 < params.len() {
                        if let (Ok(index_str), Ok(color_str)) = (
                            std::str::from_utf8(params[i]),
                            std::str::from_utf8(params[i + 1]),
                        ) {
                            if let Ok(index) = index_str.parse::<usize>() {
                                if index < 256 {
                                    if color_str == "?" {
                                        // Query - respond with current color
                                        let (r, g, b) = self.color_palette[index]
                                            .unwrap_or_else(|| default_palette_color(index as u8));
                                        let response = format!(
                                            "\x1b]4;{};rgb:{:04x}/{:04x}/{:04x}\x1b\\",
                                            index,
                                            (r as u16) * 257,
                                            (g as u16) * 257,
                                            (b as u16) * 257
                                        );
                                        self.pending_responses.push(response.into_bytes());
                                    } else if let Some(color) = parse_osc_color(color_str) {
                                        // Set palette color
                                        self.color_palette[index] = Some(color);
                                    }
                                } else if index >= 256 {
                                    // Special colors: 256=fg, 257=bg, 258=cursor
                                    let special_index = index - 256;
                                    if color_str == "?" {
                                        let color = match special_index {
                                            0 => self.default_fg_color.unwrap_or((255, 255, 255)),
                                            1 => self.default_bg_color.unwrap_or((0, 0, 0)),
                                            2 => self.cursor_color.unwrap_or((255, 255, 255)),
                                            _ => (0, 0, 0),
                                        };
                                        let response = format!(
                                            "\x1b]4;{};rgb:{:04x}/{:04x}/{:04x}\x1b\\",
                                            index,
                                            (color.0 as u16) * 257,
                                            (color.1 as u16) * 257,
                                            (color.2 as u16) * 257
                                        );
                                        self.pending_responses.push(response.into_bytes());
                                    } else if let Some(color) = parse_osc_color(color_str) {
                                        match special_index {
                                            0 => self.default_fg_color = Some(color),
                                            1 => self.default_bg_color = Some(color),
                                            2 => self.cursor_color = Some(color),
                                            _ => {}
                                        }
                                    }
                                }
                            }
                        }
                        i += 2;
                    }
                }
                // OSC 5 - Query/Set special color (direct access)
                // Format: OSC 5 ; index ; colorspec ST or OSC 5 ; index ; ? ST
                // Index: 0=foreground, 1=background, 2=cursor
                "5" => {
                    let mut i = 1;
                    while i + 1 < params.len() {
                        if let (Ok(index_str), Ok(color_str)) = (
                            std::str::from_utf8(params[i]),
                            std::str::from_utf8(params[i + 1]),
                        ) {
                            if let Ok(index) = index_str.parse::<usize>() {
                                if color_str == "?" {
                                    let color = match index {
                                        0 => self.default_fg_color.unwrap_or((255, 255, 255)),
                                        1 => self.default_bg_color.unwrap_or((0, 0, 0)),
                                        2 => self.cursor_color.unwrap_or((255, 255, 255)),
                                        _ => (0, 0, 0),
                                    };
                                    let response = format!(
                                        "\x1b]5;{};rgb:{:04x}/{:04x}/{:04x}\x1b\\",
                                        index,
                                        (color.0 as u16) * 257,
                                        (color.1 as u16) * 257,
                                        (color.2 as u16) * 257
                                    );
                                    self.pending_responses.push(response.into_bytes());
                                } else if let Some(color) = parse_osc_color(color_str) {
                                    match index {
                                        0 => self.default_fg_color = Some(color),
                                        1 => self.default_bg_color = Some(color),
                                        2 => self.cursor_color = Some(color),
                                        _ => {}
                                    }
                                }
                            }
                        }
                        i += 2;
                    }
                }
                // OSC 10 - Query/Set default foreground color (and optionally 11, 12, etc.)
                // Multiple values cascade to subsequent dynamic colors
                "10" => {
                    for (idx, param) in params.iter().skip(1).enumerate() {
                        let color_index = 10 + idx; // 10=fg, 11=bg, 12=cursor, etc.
                        if let Ok(color_str) = std::str::from_utf8(param) {
                            if color_str == "?" {
                                // Query this dynamic color
                                // Use outer terminal's colors if available, otherwise use defaults
                                let (r, g, b) = match color_index {
                                    10 => self.default_fg_color.unwrap_or_else(default_fg_color),
                                    11 => self.default_bg_color.unwrap_or_else(default_bg_color),
                                    12 => self.cursor_color.unwrap_or((255, 255, 255)),
                                    _ => continue,
                                };
                                let response = format!(
                                    "\x1b]{};rgb:{:04x}/{:04x}/{:04x}\x1b\\",
                                    color_index,
                                    (r as u16) * 257,
                                    (g as u16) * 257,
                                    (b as u16) * 257
                                );
                                self.pending_responses.push(response.into_bytes());
                            } else if let Some(color) = parse_osc_color(color_str) {
                                // Set this dynamic color
                                match color_index {
                                    10 => self.default_fg_color = Some(color),
                                    11 => self.default_bg_color = Some(color),
                                    12 => self.cursor_color = Some(color),
                                    _ => {}
                                }
                            }
                        }
                    }
                }
                // OSC 11 - Query/Set default background color (and optionally 12, etc.)
                "11" => {
                    for (idx, param) in params.iter().skip(1).enumerate() {
                        let color_index = 11 + idx; // 11=bg, 12=cursor, etc.
                        if let Ok(color_str) = std::str::from_utf8(param) {
                            if color_str == "?" {
                                // Query this dynamic color
                                // Use outer terminal's colors if available
                                let (r, g, b) = match color_index {
                                    11 => self.default_bg_color.unwrap_or_else(default_bg_color),
                                    12 => self.cursor_color.unwrap_or((255, 255, 255)),
                                    _ => continue,
                                };
                                let response = format!(
                                    "\x1b]{};rgb:{:04x}/{:04x}/{:04x}\x1b\\",
                                    color_index,
                                    (r as u16) * 257,
                                    (g as u16) * 257,
                                    (b as u16) * 257
                                );
                                self.pending_responses.push(response.into_bytes());
                            } else if let Some(color) = parse_osc_color(color_str) {
                                // Set this dynamic color
                                match color_index {
                                    11 => self.default_bg_color = Some(color),
                                    12 => self.cursor_color = Some(color),
                                    _ => {}
                                }
                            }
                        }
                    }
                }
                // OSC 110 - Reset default foreground color to terminal default
                "110" => {
                    self.default_fg_color = None;
                }
                // OSC 111 - Reset default background color to terminal default
                "111" => {
                    self.default_bg_color = None;
                }
                // OSC 12 - Query/Set cursor color
                "12" => {
                    if params.len() > 1 {
                        if let Ok(color_str) = std::str::from_utf8(params[1]) {
                            if color_str == "?" {
                                // Query - respond with current cursor color (default to white if not set)
                                let (r, g, b) = self.cursor_color.unwrap_or((255, 255, 255));
                                let response = format!(
                                    "\x1b]12;rgb:{:04x}/{:04x}/{:04x}\x1b\\",
                                    (r as u16) * 257,
                                    (g as u16) * 257,
                                    (b as u16) * 257
                                );
                                self.pending_responses.push(response.into_bytes());
                            } else if color_str == "default" {
                                // Special value "default" resets cursor color
                                self.cursor_color = None;
                            } else if let Some(color) = parse_osc_color(color_str) {
                                // Set cursor color
                                self.cursor_color = Some(color);
                            }
                        }
                    }
                }
                // OSC 112 - Reset cursor color to terminal default
                "112" => {
                    self.cursor_color = None;
                }
                // OSC 104 - Reset palette color(s) to default
                // Format: OSC 104 ; index ST (reset specific) or OSC 104 ST (reset all)
                "104" => {
                    if params.len() == 1 {
                        // No index specified - reset all palette colors
                        self.color_palette = [None; 256];
                    } else {
                        // Reset specific indices
                        for param in params.iter().skip(1) {
                            if let Ok(index_str) = std::str::from_utf8(param) {
                                if let Ok(index) = index_str.parse::<usize>() {
                                    if index < 256 {
                                        self.color_palette[index] = None;
                                    }
                                }
                            }
                        }
                    }
                }
                // OSC 105 - Reset special color(s) to default
                // Format: OSC 105 ; index ST
                "105" => {
                    if params.len() == 1 {
                        // No index - reset all special colors
                        self.default_fg_color = None;
                        self.default_bg_color = None;
                        self.cursor_color = None;
                    } else {
                        for param in params.iter().skip(1) {
                            if let Ok(index_str) = std::str::from_utf8(param) {
                                if let Ok(index) = index_str.parse::<usize>() {
                                    match index {
                                        0 => self.default_fg_color = None,
                                        1 => self.default_bg_color = None,
                                        2 => self.cursor_color = None,
                                        _ => {}
                                    }
                                }
                            }
                        }
                    }
                }
                _ => {}
            }
        }
    }

    fn csi_dispatch(&mut self, params: &Params, intermediates: &[u8], _ignore: bool, action: char) {
        let params_vec: Vec<u16> = params.iter().map(|p| p[0]).collect();

        match action {
            // Cursor Up
            'A' => {
                let n = params_vec.first().copied().unwrap_or(1).max(1) as usize;
                self.internal_grid.cursor_row = self.internal_grid.cursor_row.saturating_sub(n);
            }
            // Cursor Down
            'B' => {
                let n = params_vec.first().copied().unwrap_or(1).max(1) as usize;
                self.internal_grid.cursor_row =
                    (self.internal_grid.cursor_row + n).min(self.internal_grid.rows - 1);
            }
            // Cursor Forward
            'C' => {
                let n = params_vec.first().copied().unwrap_or(1).max(1) as usize;
                let max_col = if self.enable_left_right_margins
                    && self.internal_grid.cursor_col >= self.internal_grid.left_margin
                    && self.internal_grid.cursor_col <= self.internal_grid.right_margin
                {
                    self.internal_grid.right_margin
                } else {
                    self.internal_grid.cols - 1
                };
                self.internal_grid.cursor_col = (self.internal_grid.cursor_col + n).min(max_col);
            }
            // Cursor Back
            'D' => {
                let n = params_vec.first().copied().unwrap_or(1).max(1) as usize;
                let min_col = if self.enable_left_right_margins
                    && self.internal_grid.cursor_col >= self.internal_grid.left_margin
                    && self.internal_grid.cursor_col <= self.internal_grid.right_margin
                {
                    self.internal_grid.left_margin
                } else {
                    0
                };
                self.internal_grid.cursor_col =
                    self.internal_grid.cursor_col.saturating_sub(n).max(min_col);
            }
            // Cursor Next Line
            'E' => {
                let n = params_vec.first().copied().unwrap_or(1).max(1) as usize;
                self.internal_grid.cursor_row =
                    (self.internal_grid.cursor_row + n).min(self.internal_grid.rows - 1);
                self.internal_grid.cursor_col = 0;
            }
            // Cursor Previous Line
            'F' => {
                let n = params_vec.first().copied().unwrap_or(1).max(1) as usize;
                self.internal_grid.cursor_row = self.internal_grid.cursor_row.saturating_sub(n);
                self.internal_grid.cursor_col = 0;
            }
            // Cursor Horizontal Absolute
            'G' => {
                let col = params_vec.first().copied().unwrap_or(1).max(1) as usize;
                self.internal_grid.cursor_col = (col - 1).min(self.internal_grid.cols - 1);
            }
            // Cursor Position (CUP)
            'H' | 'f' => {
                let row = params_vec.first().copied().unwrap_or(1).max(1) as usize;
                let col = params_vec.get(1).copied().unwrap_or(1).max(1) as usize;

                if self.origin_mode {
                    // In origin mode, cursor positions are relative to scroll region
                    let (top, bottom) = self.internal_grid.scroll_region;
                    let left = self.internal_grid.left_margin;
                    let right = self.internal_grid.right_margin;

                    // Position is relative to margin origin
                    let abs_row = top + row - 1;
                    let abs_col = left + col - 1;

                    // Clamp to scroll region
                    self.internal_grid.cursor_row = abs_row.min(bottom);
                    self.internal_grid.cursor_col = abs_col.min(right);
                } else {
                    // Normal mode - absolute positioning
                    self.internal_grid.cursor_row = (row - 1).min(self.internal_grid.rows - 1);
                    self.internal_grid.cursor_col = (col - 1).min(self.internal_grid.cols - 1);
                }
            }
            // Erase in Display
            'J' => {
                let mode = params_vec.first().copied().unwrap_or(0);
                match mode {
                    0 => self.clear_to_end_of_screen(),
                    1 => self.clear_to_start_of_screen(),
                    2 | 3 => self.clear_screen(),
                    _ => {}
                }
            }
            // Erase in Line
            'K' => {
                let mode = params_vec.first().copied().unwrap_or(0);
                match mode {
                    0 => self.clear_to_end_of_line(),
                    1 => self.clear_to_start_of_line(),
                    2 => self.clear_line(),
                    _ => {}
                }
            }
            // Insert Lines (IL) - insert blank lines at cursor, shift lines down
            'L' => {
                let n = params_vec.first().copied().unwrap_or(1).max(1) as usize;
                self.internal_grid.insert_lines_at_cursor(n);
            }
            // Delete Lines (DL) - delete lines at cursor, shift lines up
            'M' => {
                let n = params_vec.first().copied().unwrap_or(1).max(1) as usize;
                self.internal_grid.delete_lines_at_cursor(n);
            }
            // Delete Characters
            'P' => {
                let n = params_vec.first().copied().unwrap_or(1).max(1) as usize;
                self.internal_grid.delete_chars(n);
            }
            // Scroll Up
            'S' => {
                let n = params_vec.first().copied().unwrap_or(1).max(1) as usize;
                for _ in 0..n {
                    self.scroll_up();
                }
            }
            // Scroll Down
            'T' => {
                let n = params_vec.first().copied().unwrap_or(1).max(1) as usize;
                for _ in 0..n {
                    self.scroll_down();
                }
            }
            // Erase Characters
            'X' => {
                let n = params_vec.first().copied().unwrap_or(1).max(1) as usize;
                self.internal_grid.erase_chars(n);
            }
            // Cursor Horizontal Absolute
            '`' => {
                let col = params_vec.first().copied().unwrap_or(1).max(1) as usize;
                self.internal_grid.cursor_col = (col - 1).min(self.internal_grid.cols - 1);
            }
            // Vertical Position Absolute
            'd' => {
                let row = params_vec.first().copied().unwrap_or(1).max(1) as usize;
                self.internal_grid.cursor_row = (row - 1).min(self.internal_grid.rows - 1);
            }
            // SGR - Select Graphic Rendition
            'm' if intermediates.is_empty() => {
                self.apply_sgr(params);
            }
            // Device Status Report (DSR)
            'n' => {
                let mode = params_vec.first().copied().unwrap_or(0);
                match mode {
                    5 => {
                        // Status Report - respond with "OK" (CSI 0 n)
                        self.pending_responses.push(b"\x1b[0n".to_vec());
                    }
                    6 => {
                        // Cursor Position Report (CPR)
                        // In origin mode, report position relative to scroll region
                        let (row, col) = if self.origin_mode {
                            let (top, _) = self.internal_grid.scroll_region;
                            let left = self.internal_grid.left_margin;
                            let rel_row = self.internal_grid.cursor_row.saturating_sub(top) + 1;
                            let rel_col = self.internal_grid.cursor_col.saturating_sub(left) + 1;
                            (rel_row, rel_col)
                        } else {
                            (
                                self.internal_grid.cursor_row + 1,
                                self.internal_grid.cursor_col + 1,
                            )
                        };
                        let response = format!("\x1b[{};{}R", row, col);
                        self.pending_responses.push(response.into_bytes());
                    }
                    _ => {}
                }
            }
            // Device Attributes (DA1 and DA2)
            // Important: We must distinguish between QUERIES (which we respond to) and
            // RESPONSES (which we ignore). Both DA1 and DA2 responses have the same
            // intermediate characters as queries, so we use parameter count to distinguish:
            // - Query: no params or just [0]
            // - Response: multiple params (e.g., [64, 1, 2, ...] for DA1, [41, 354, 0] for DA2)
            'c' => {
                let is_query = params_vec.is_empty() || params_vec == [0];
                if intermediates.is_empty() && is_query {
                    // Primary Device Attributes (DA1): CSI c or CSI 0 c
                    // Respond as xterm-compatible VT420 with capabilities:
                    // 64 = VT420
                    // 1 = 132 columns
                    // 2 = printer port
                    // 6 = selective erase
                    // 9 = national replacement character sets
                    // 15 = technical character set
                    // 16 = locator port (DEC)
                    // 17 = terminal state interrogation
                    // 18 = user windows
                    // 21 = horizontal scrolling
                    // 22 = ANSI color
                    // 28 = rectangular editing
                    // 29 = ANSI text locator
                    self.pending_responses
                        .push(b"\x1b[?64;1;2;6;9;15;16;17;18;21;22;28;29c".to_vec());
                } else if intermediates == [b'>'] && is_query {
                    // Secondary Device Attributes (DA2): CSI > c or CSI > 0 c
                    // Respond as xterm version 314+:
                    // 41 = xterm terminal type
                    // 354 = version number (xterm 354+)
                    // 0 = ROM cartridge registration number (always 0)
                    self.pending_responses.push(b"\x1b[>41;354;0c".to_vec());
                }
                // DA1 responses (CSI ? params c) and DA2 responses (CSI > params c)
                // are silently consumed - they have intermediates but multiple params
            }
            // Set scroll region
            'r' => {
                let top = params_vec.first().copied().unwrap_or(1).max(1) as usize - 1;
                let bottom = params_vec
                    .get(1)
                    .copied()
                    .unwrap_or(self.internal_grid.rows as u16)
                    .max(1) as usize
                    - 1;
                if top < self.internal_grid.rows
                    && bottom < self.internal_grid.rows
                    && top <= bottom
                {
                    self.internal_grid.scroll_region = (top, bottom);
                }
                self.internal_grid.cursor_row = 0;
                self.internal_grid.cursor_col = 0;
            }
            // DECSLRM (set left/right margin) or save cursor (ANSI.SYS style)
            's' => {
                if self.enable_left_right_margins {
                    // DECSLRM - Set Left and Right Margins
                    let left = params_vec.first().copied().unwrap_or(1).max(1) as usize;
                    let right = params_vec
                        .get(1)
                        .copied()
                        .unwrap_or(self.internal_grid.cols as u16)
                        .max(1) as usize;

                    // Convert to 0-indexed and clamp to valid range
                    let left_idx = (left - 1).min(self.internal_grid.cols.saturating_sub(1));
                    let right_idx = (right - 1).min(self.internal_grid.cols.saturating_sub(1));

                    // Only set if left < right
                    if left_idx < right_idx {
                        self.internal_grid.left_margin = left_idx;
                        self.internal_grid.right_margin = right_idx;
                    }
                    // Cursor moves to home position
                    self.internal_grid.cursor_row = 0;
                    self.internal_grid.cursor_col = 0;
                } else {
                    // Save cursor position (ANSI.SYS style)
                    self.save_cursor();
                }
            }
            // Restore cursor position (ANSI.SYS style)
            'u' => {
                self.restore_cursor();
            }
            // Cursor Backward Tabulation (CBT)
            'Z' => {
                let n = params_vec.first().copied().unwrap_or(1).max(1) as usize;
                self.tab_backward(n);
            }
            // Repeat previous character (REP)
            'b' => {
                let n = params_vec.first().copied().unwrap_or(1).max(1) as usize;
                self.repeat_char(n);
            }
            // Tab Clear (TBC)
            'g' => {
                let mode = params_vec.first().copied().unwrap_or(0);
                match mode {
                    0 => self.clear_tab_stop_at_cursor(),
                    3 => self.clear_all_tab_stops(),
                    _ => {}
                }
            }
            // Insert Characters (ICH)
            '@' => {
                let n = params_vec.first().copied().unwrap_or(1).max(1) as usize;
                self.insert_chars(n);
            }
            // Soft Terminal Reset (DECSTR) - CSI ! p
            'p' if intermediates == [b'!'] => {
                self.soft_reset();
            }
            // Private modes (DECSET/DECRST) and standard modes (SM/RM)
            'h' | 'l' => {
                let enable = action == 'h';
                if intermediates == [b'?'] {
                    // Private (DEC) modes
                    for &param in &params_vec {
                        match param {
                            1 => {
                                // DECCKM - Cursor Keys Mode
                                self.application_cursor_keys = enable;
                            }
                            6 => {
                                // DECOM - Origin Mode
                                self.origin_mode = enable;
                                self.internal_grid.cursor_row = 0;
                                self.internal_grid.cursor_col = 0;
                            }
                            7 => {
                                // DECAWM - Auto-wrap Mode
                                self.auto_wrap = enable;
                            }
                            12 => {
                                // Cursor blink mode
                                // h = enable blink, l = disable blink (steady cursor)
                                self.cursor_blink = enable;
                            }
                            25 => {
                                // DECTCEM - Cursor visibility
                                self.cursor_visible = enable;
                            }
                            1049 => {
                                // Alternate screen buffer (save cursor + switch)
                                // Per xterm, mode 1049 combines 1047 (alt screen) + 1048 (save/restore cursor)
                                if enable {
                                    // Only enter if not already in alternate screen
                                    // (prevents losing main screen if app sends 1049h twice)
                                    if self.alternate_screen.is_none() {
                                        self.alternate_screen = Some(Box::new(AlternateScreen {
                                            grid: self.internal_grid.clone(),
                                            cursor_row: self.internal_grid.cursor_row,
                                            cursor_col: self.internal_grid.cursor_col,
                                            current_styles: self.internal_grid.current_styles,
                                            // Save terminal modes that affect cursor positioning
                                            origin_mode: self.origin_mode,
                                            auto_wrap: self.auto_wrap,
                                            pending_wrap: self.pending_wrap,
                                            // Save cursor visibility (per-screen state)
                                            cursor_visible: self.cursor_visible,
                                            cursor_blink: self.cursor_blink,
                                            // Save charset state
                                            charset_index: self.charset_index,
                                            g0_charset_line_drawing: self.g0_charset_line_drawing,
                                            g1_charset_line_drawing: self.g1_charset_line_drawing,
                                        }));
                                        // Clear any saved cursor from before alt screen - it's now stale
                                        self.saved_cursor = None;
                                        let rows = self.internal_grid.rows;
                                        let cols = self.internal_grid.cols;
                                        self.internal_grid = Grid::new(rows, cols);
                                        self.alt_screen_toggled = true;
                                    }
                                } else if let Some(saved) = self.alternate_screen.take() {
                                    // Resize saved grid to current dimensions if needed
                                    let mut restored = saved.grid;
                                    restored
                                        .resize(self.internal_grid.rows, self.internal_grid.cols);
                                    self.internal_grid = restored;
                                    // Mark all lines as changed to force full redraw
                                    // (resize only marks changed if dimensions actually change)
                                    self.internal_grid.mark_all_changed();
                                    self.internal_grid.cursor_row = saved
                                        .cursor_row
                                        .min(self.internal_grid.rows.saturating_sub(1));
                                    self.internal_grid.cursor_col = saved
                                        .cursor_col
                                        .min(self.internal_grid.cols.saturating_sub(1));
                                    self.internal_grid.set_current_styles(saved.current_styles);
                                    // Restore terminal modes
                                    self.origin_mode = saved.origin_mode;
                                    self.auto_wrap = saved.auto_wrap;
                                    self.pending_wrap = saved.pending_wrap;
                                    // Restore cursor visibility
                                    self.cursor_visible = saved.cursor_visible;
                                    self.cursor_blink = saved.cursor_blink;
                                    // Restore charset state
                                    self.charset_index = saved.charset_index;
                                    self.g0_charset_line_drawing = saved.g0_charset_line_drawing;
                                    self.g1_charset_line_drawing = saved.g1_charset_line_drawing;
                                    // Clear saved_cursor instead of restoring stale state
                                    // When a TUI exits, any cursor position it saved before entering
                                    // alt screen is no longer relevant. If we restore it, subsequent
                                    // commands that call RESTORE_CURSOR (like codex) would jump to
                                    // that stale position.
                                    self.saved_cursor = None;
                                    self.alt_screen_toggled = true;
                                }
                            }
                            47 | 1047 => {
                                // Alternate screen buffer (without save cursor)
                                // Per xterm, mode 47/1047 switches screen but doesn't save/restore cursor
                                if enable {
                                    // Only enter if not already in alternate screen
                                    if self.alternate_screen.is_none() {
                                        self.alternate_screen = Some(Box::new(AlternateScreen {
                                            grid: self.internal_grid.clone(),
                                            cursor_row: self.internal_grid.cursor_row,
                                            cursor_col: self.internal_grid.cursor_col,
                                            current_styles: self.internal_grid.current_styles,
                                            // Save terminal modes (struct fields required)
                                            origin_mode: self.origin_mode,
                                            auto_wrap: self.auto_wrap,
                                            pending_wrap: self.pending_wrap,
                                            cursor_visible: self.cursor_visible,
                                            cursor_blink: self.cursor_blink,
                                            charset_index: self.charset_index,
                                            g0_charset_line_drawing: self.g0_charset_line_drawing,
                                            g1_charset_line_drawing: self.g1_charset_line_drawing,
                                        }));
                                        // Clear any saved cursor from before alt screen - it's now stale
                                        self.saved_cursor = None;
                                        let rows = self.internal_grid.rows;
                                        let cols = self.internal_grid.cols;
                                        self.internal_grid = Grid::new(rows, cols);
                                        self.alt_screen_toggled = true;
                                    }
                                } else if let Some(saved) = self.alternate_screen.take() {
                                    let mut restored = saved.grid;
                                    restored
                                        .resize(self.internal_grid.rows, self.internal_grid.cols);
                                    self.internal_grid = restored;
                                    // Mark all lines as changed to force full redraw
                                    // (resize only marks changed if dimensions actually change)
                                    self.internal_grid.mark_all_changed();
                                    // Note: modes 47/1047 don't restore cursor position or terminal modes
                                    // Only the grid content is restored
                                    // But we do restore cursor visibility
                                    self.cursor_visible = saved.cursor_visible;
                                    self.cursor_blink = saved.cursor_blink;
                                    // Clear saved_cursor instead of restoring stale state
                                    self.saved_cursor = None;
                                    self.alt_screen_toggled = true;
                                }
                            }
                            2004 => {
                                // Bracketed paste mode
                                self.bracketed_paste = enable;
                            }
                            // Mouse tracking modes
                            1000 | 1002 | 1003 => {
                                if enable {
                                    self.mouse_tracking = Some(param);
                                } else {
                                    self.mouse_tracking = None;
                                }
                            }
                            1006 => {
                                // SGR extended mouse mode
                                self.sgr_mouse_mode = enable;
                            }
                            45 => {
                                // Reverse wraparound mode
                                self.reverse_wraparound = enable;
                            }
                            69 => {
                                // DECLRMM - Left/Right Margin Mode
                                self.enable_left_right_margins = enable;
                                if !enable {
                                    // Reset margins when mode is disabled
                                    self.internal_grid.left_margin = 0;
                                    self.internal_grid.right_margin =
                                        self.internal_grid.cols.saturating_sub(1);
                                }
                            }
                            _ => {}
                        }
                    }
                } else {
                    // Standard (ANSI) modes
                    for &param in &params_vec {
                        match param {
                            4 => {
                                // IRM - Insert/Replace Mode
                                self.insert_mode = enable;
                            }
                            20 => {
                                // LNM - Line Feed/New Line Mode
                                self.newline_mode = enable;
                            }
                            _ => {}
                        }
                    }
                }
            }
            // Window manipulation (XTERM_WINOPS) - CSI Ps t
            't' => {
                let op = params_vec.first().copied().unwrap_or(0);
                if op == 18 {
                    // Report text area size in characters
                    // Response: CSI 8 ; height ; width t
                    let response = format!(
                        "\x1b[8;{};{}t",
                        self.internal_grid.rows, self.internal_grid.cols
                    );
                    self.pending_responses.push(response.into_bytes());
                }
            }
            // DECRQCRA - Request Checksum of Rectangular Area
            // CSI Pid ; Pp ; Pt ; Pl ; Pb ; Pr * y
            'y' if intermediates == [b'*'] => {
                let pid = params_vec.first().copied().unwrap_or(0);
                let _page = params_vec.get(1).copied().unwrap_or(1); // page number, ignored
                let top = params_vec.get(2).copied().unwrap_or(1).max(1) as usize;
                let left = params_vec.get(3).copied().unwrap_or(1).max(1) as usize;
                let bottom = params_vec
                    .get(4)
                    .copied()
                    .unwrap_or(self.internal_grid.rows as u16)
                    .max(1) as usize;
                let right = params_vec
                    .get(5)
                    .copied()
                    .unwrap_or(self.internal_grid.cols as u16)
                    .max(1) as usize;

                // Calculate checksum of characters in the rectangular area
                let checksum = self.calculate_rect_checksum(top, left, bottom, right);

                // Response: DCS Pid ! ~ XXXX ST (where XXXX is 4-digit hex checksum)
                let response = format!("\x1bP{}!~{:04X}\x1b\\", pid, checksum);
                self.pending_responses.push(response.into_bytes());
            }
            // DECRQM - Request Mode (CSI Ps $ p for ANSI, CSI ? Ps $ p for DEC)
            // Note: intermediates order may vary in vte-rs, so check contains
            'p' if intermediates.contains(&b'$') => {
                let mode = params_vec.first().copied().unwrap_or(0);
                let is_dec_mode = intermediates.contains(&b'?');

                // Get mode status: 1=set, 2=reset, 0=not recognized
                let status = if is_dec_mode {
                    match mode {
                        1 => {
                            // DECCKM - Cursor Keys Mode
                            if self.application_cursor_keys {
                                1
                            } else {
                                2
                            }
                        }
                        6 => {
                            // DECOM - Origin Mode
                            if self.origin_mode {
                                1
                            } else {
                                2
                            }
                        }
                        7 => {
                            // DECAWM - Auto-wrap Mode
                            if self.auto_wrap {
                                1
                            } else {
                                2
                            }
                        }
                        25 => {
                            // DECTCEM - Cursor Visible
                            if self.cursor_visible {
                                1
                            } else {
                                2
                            }
                        }
                        45 => {
                            // Reverse Wraparound
                            if self.reverse_wraparound {
                                1
                            } else {
                                2
                            }
                        }
                        47 | 1047 | 1049 => {
                            // Alternate screen
                            if self.alternate_screen.is_some() {
                                1
                            } else {
                                2
                            }
                        }
                        69 => {
                            // DECLRMM - Left/Right Margin Mode
                            if self.enable_left_right_margins {
                                1
                            } else {
                                2
                            }
                        }
                        1000 | 1002 | 1003 => {
                            // Mouse tracking modes
                            if self.mouse_tracking == Some(mode) {
                                1
                            } else {
                                2
                            }
                        }
                        2004 => {
                            // Bracketed paste
                            if self.bracketed_paste {
                                1
                            } else {
                                2
                            }
                        }
                        // Permanently reset DEC modes (not modifiable - we don't track them) - return 4
                        3 => 4,  // DECCOLM - 132 column mode (not supported)
                        4 => 4,  // DECSCLM - Smooth scroll (not supported)
                        5 => 4,  // DECSCNM - Screen reverse video (not supported)
                        8 => 4,  // DECARM - Auto repeat (not supported)
                        18 => 4, // DECPFF - Print form feed (not supported)
                        19 => 4, // DECPEX - Print extent (not supported)
                        42 => 4, // DECNRCM - National replacement character (not supported)
                        60 => 4, // DECHCCM - Horizontal cursor coupling (not supported)
                        61 => 4, // DECVCCM - Vertical cursor coupling (not supported)
                        64 => 4, // DECPCCM - Page cursor coupling (not supported)
                        66 => 4, // DECNKM - Numeric keypad mode (not supported)
                        67 => 4, // DECBKM - Backarrow key mode (not supported)
                        68 => 4, // DECKBUM - Keyboard usage mode (not supported)
                        73 => 4, // DECXRLM - Transmit rate limiting (not supported)
                        81 => 4, // DECKPM - Key position mode (not supported)
                        // Not recognized
                        _ => 0,
                    }
                } else {
                    // ANSI modes
                    match mode {
                        // Permanently reset modes (not modifiable in xterm) - return 4
                        1 => 4,  // GATM - Guarded Area Transfer Mode
                        5 => 4,  // SRTM - Status Reporting Transfer Mode
                        7 => 4,  // VEM - Vertical Editing Mode
                        10 => 4, // HEM - Horizontal Editing Mode
                        11 => 4, // PUM - Positioning Unit Mode
                        13 => 4, // FEAM - Format Effector Action Mode
                        14 => 4, // FETM - Format Effector Transfer Mode
                        15 => 4, // MATM - Multiple Area Transfer Mode
                        16 => 4, // TTM - Transfer Termination Mode
                        17 => 4, // SATM - Selected Area Transfer Mode
                        18 => 4, // TSM - Tabulation Stop Mode
                        19 => 4, // EBM - Editing Boundary Mode
                        // KAM and SRM - we don't track these, mark as permanently reset
                        2 => 4, // KAM - Keyboard Action Mode (not tracked)
                        4 => {
                            // IRM - Insert Mode (we do track this)
                            if self.insert_mode {
                                1
                            } else {
                                2
                            }
                        }
                        12 => 4, // SRM - Send/Receive Mode (not tracked)
                        20 => {
                            // LNM - Line Feed/New Line Mode
                            if self.newline_mode {
                                1
                            } else {
                                2
                            }
                        }
                        _ => 0, // Not recognized
                    }
                };

                // Response format: CSI Ps ; Pm $ y (ANSI) or CSI ? Ps ; Pm $ y (DEC)
                let response = if is_dec_mode {
                    format!("\x1b[?{};{}$y", mode, status)
                } else {
                    format!("\x1b[{};{}$y", mode, status)
                };
                self.pending_responses.push(response.into_bytes());
            }
            // DECFRA - Fill Rectangular Area: CSI Pc ; Pt ; Pl ; Pb ; Pr $ x
            'x' if intermediates == [b'$'] => {
                let char_code = params_vec.first().copied().unwrap_or(32) as u8; // Default: space
                let ch = if (32..127).contains(&char_code) {
                    char_code as char
                } else {
                    ' '
                };

                // Get rectangle bounds (1-based, convert to 0-based)
                let top = params_vec.get(1).copied().unwrap_or(1).max(1) as usize - 1;
                let left = params_vec.get(2).copied().unwrap_or(1).max(1) as usize - 1;
                let bottom = params_vec
                    .get(3)
                    .copied()
                    .unwrap_or(self.internal_grid.rows as u16)
                    .max(1) as usize
                    - 1;
                let right = params_vec
                    .get(4)
                    .copied()
                    .unwrap_or(self.internal_grid.cols as u16)
                    .max(1) as usize
                    - 1;

                // Apply origin mode offset if enabled (both row and column margins)
                let (top, bottom, left, right) = if self.origin_mode {
                    let (scroll_top, scroll_bottom) = self.internal_grid.scroll_region;
                    let left_margin = self.internal_grid.left_margin;
                    let right_margin = self.internal_grid.right_margin;
                    (
                        (top + scroll_top).min(scroll_bottom),
                        (bottom + scroll_top).min(scroll_bottom),
                        (left + left_margin).min(right_margin),
                        (right + left_margin).min(right_margin),
                    )
                } else {
                    (
                        top.min(self.internal_grid.rows - 1),
                        bottom.min(self.internal_grid.rows - 1),
                        left.min(self.internal_grid.cols - 1),
                        right.min(self.internal_grid.cols - 1),
                    )
                };

                // Validate rectangle (top <= bottom, left <= right)
                if top <= bottom && left <= right {
                    let shared_styles = self.internal_grid.current_shared_styles();
                    for row in top..=bottom {
                        for col in left..=right {
                            let character = TerminalCharacter::new(ch, shared_styles.clone());
                            self.internal_grid.set_char(row, col, character);
                        }
                    }
                }
            }
            // DECERA - Erase Rectangular Area: CSI Pt ; Pl ; Pb ; Pr $ z
            'z' if intermediates == [b'$'] => {
                // Get rectangle bounds (1-based, convert to 0-based)
                let top = params_vec.first().copied().unwrap_or(1).max(1) as usize - 1;
                let left = params_vec.get(1).copied().unwrap_or(1).max(1) as usize - 1;
                let bottom = params_vec
                    .get(2)
                    .copied()
                    .unwrap_or(self.internal_grid.rows as u16)
                    .max(1) as usize
                    - 1;
                let right = params_vec
                    .get(3)
                    .copied()
                    .unwrap_or(self.internal_grid.cols as u16)
                    .max(1) as usize
                    - 1;

                // Apply origin mode offset if enabled (both row and column margins)
                let (top, bottom, left, right) = if self.origin_mode {
                    let (scroll_top, scroll_bottom) = self.internal_grid.scroll_region;
                    let left_margin = self.internal_grid.left_margin;
                    let right_margin = self.internal_grid.right_margin;
                    (
                        (top + scroll_top).min(scroll_bottom),
                        (bottom + scroll_top).min(scroll_bottom),
                        (left + left_margin).min(right_margin),
                        (right + left_margin).min(right_margin),
                    )
                } else {
                    (
                        top.min(self.internal_grid.rows - 1),
                        bottom.min(self.internal_grid.rows - 1),
                        left.min(self.internal_grid.cols - 1),
                        right.min(self.internal_grid.cols - 1),
                    )
                };

                // Validate rectangle (top <= bottom, left <= right)
                // DECERA erases using current SGR attributes (per xterm behavior)
                if top <= bottom && left <= right {
                    let blank = TerminalCharacter::blank_with_style(
                        self.internal_grid.current_shared_styles(),
                    );
                    for row in top..=bottom {
                        for col in left..=right {
                            self.internal_grid.set_char(row, col, blank.clone());
                        }
                    }
                }
            }
            // DECSCUSR - Set Cursor Style: CSI Ps SP q
            // Ps=0 or default: blinking block
            // Ps=1: blinking block, Ps=2: steady block
            // Ps=3: blinking underline, Ps=4: steady underline
            // Ps=5: blinking bar, Ps=6: steady bar
            'q' if intermediates == [b' '] => {
                let style = params_vec.first().copied().unwrap_or(0);
                self.cursor_style = style as u8;
                // Odd values are blinking, even values (including 0) are steady
                // Exception: 0 means "default" which is typically blinking
                self.cursor_blink = style == 0 || style % 2 == 1;
            }
            _ => {}
        }

        // Clear pending wrap on cursor movement
        if matches!(
            action,
            'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'f' | 'd' | '`'
        ) {
            self.pending_wrap = false;
        }
    }

    fn esc_dispatch(&mut self, intermediates: &[u8], _ignore: bool, byte: u8) {
        match (intermediates, byte) {
            // Save cursor (DECSC)
            ([], b'7') => {
                self.save_cursor();
            }
            // Restore cursor (DECRC)
            ([], b'8') => {
                self.restore_cursor();
            }
            // Reset (RIS)
            ([], b'c') => {
                let rows = self.internal_grid.rows;
                let cols = self.internal_grid.cols;
                *self = VirtualTerminal::new(rows, cols);
            }
            // Index - move down one line, scroll if at bottom
            ([], b'D') => {
                self.newline();
            }
            // Next Line
            ([], b'E') => {
                self.newline();
                self.internal_grid.cursor_col = 0;
            }
            // Horizontal Tab Set (HTS)
            ([], b'H') => {
                self.set_tab_stop_at_cursor();
            }
            // Reverse Index - move up one line, scroll if at top
            ([], b'M') => {
                if self.internal_grid.cursor_row == self.internal_grid.scroll_region.0 {
                    self.scroll_down();
                } else {
                    self.internal_grid.cursor_row = self.internal_grid.cursor_row.saturating_sub(1);
                }
            }
            // G0 charset designations
            ([b'('], b'0') => {
                self.g0_charset_line_drawing = true;
            }
            ([b'('], b'B') => {
                self.g0_charset_line_drawing = false;
            }
            // G1 charset designations
            ([b')'], b'0') => {
                self.g1_charset_line_drawing = true;
            }
            ([b')'], b'B') => {
                self.g1_charset_line_drawing = false;
            }
            // Application keypad mode (DECKPAM)
            ([], b'=') => {
                self.application_keypad = true;
            }
            // Normal keypad mode (DECKPNM)
            ([], b'>') => {
                self.application_keypad = false;
            }
            _ => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn virtual_terminal_handles_basic_text() {
        let mut term = VirtualTerminal::new(24, 80);
        term.process(b"Hello, World!");
        assert_eq!(term.get_cell(0, 0).c, 'H');
        assert_eq!(term.get_cell(0, 6).c, ' ');
        assert_eq!(term.get_cell(0, 7).c, 'W');
    }

    #[test]
    fn virtual_terminal_handles_newline() {
        let mut term = VirtualTerminal::new(24, 80);
        term.process(b"Line 1\nLine 2");
        assert_eq!(term.get_cell(0, 0).c, 'L');
        assert_eq!(term.get_cell(1, 0).c, 'L');
    }

    #[test]
    fn virtual_terminal_handles_cursor_movement() {
        let mut term = VirtualTerminal::new(24, 80);
        term.process(b"Hello\x1b[2;1HWorld"); // Move to row 2, col 1
        assert_eq!(term.get_cell(0, 0).c, 'H');
        assert_eq!(term.get_cell(1, 0).c, 'W');
    }

    #[test]
    fn virtual_terminal_handles_colors() {
        let mut term = VirtualTerminal::new(24, 80);
        term.process(b"\x1b[31mRed\x1b[0m");
        let cell = term.get_cell(0, 0);
        assert_eq!(cell.c, 'R');
        assert_eq!(cell.style.fg, Some(Color::Red));
    }

    #[test]
    fn virtual_terminal_resize() {
        let mut term = VirtualTerminal::new(24, 80);
        term.process(b"Test");
        term.resize(30, 100);
        assert_eq!(term.rows(), 30);
        assert_eq!(term.cols(), 100);
        assert_eq!(term.get_cell(0, 0).c, 'T');
    }
}
