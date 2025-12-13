#!/bin/bash
# Test escape sequence support in the terminal emulator
# Run this script inside cmux/dmux to verify escape sequence support

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "=== Terminal Escape Sequence Tester ==="
echo ""

# Function to test an escape sequence query and check the response
test_sequence() {
    local name="$1"
    local sequence="$2"
    local expected_pattern="$3"

    # Save terminal settings
    old_stty=$(stty -g)

    # Set terminal to raw mode with timeout
    stty raw -echo min 0 time 10

    # Send the sequence and read response
    printf "%b" "$sequence"
    response=$(dd bs=1 count=50 2>/dev/null | cat -v)

    # Restore terminal settings
    stty "$old_stty"

    echo -n "Testing $name: "

    if [[ "$response" =~ $expected_pattern ]]; then
        echo -e "${GREEN}PASS${NC}"
        echo "  Response: $response"
        return 0
    else
        echo -e "${RED}FAIL${NC}"
        echo "  Expected pattern: $expected_pattern"
        echo "  Got: $response"
        return 1
    fi
}

echo "--- Device Attributes Tests ---"
echo ""

# Test DA1 (Primary Device Attributes)
echo -n "Testing DA1 (CSI c): "
old_stty=$(stty -g)
stty raw -echo min 0 time 10
printf '\033[c'
response=$(dd bs=1 count=100 2>/dev/null | cat -v)
stty "$old_stty"
if [[ "$response" == *"[?64;1;2;6;9;15;16;17;18;21;22;28;29c"* ]]; then
    echo -e "${GREEN}PASS${NC}"
    echo "  Response: $response"
    echo "  Decoded: VT420 (64) with many capabilities"
else
    echo -e "${RED}FAIL${NC}"
    echo "  Expected: ^[[?64;1;2;6;9;15;16;17;18;21;22;28;29c"
    echo "  Got: $response"
fi

echo ""

# Test DA2 (Secondary Device Attributes)
echo -n "Testing DA2 (CSI > c): "
old_stty=$(stty -g)
stty raw -echo min 0 time 10
printf '\033[>c'
response=$(dd bs=1 count=50 2>/dev/null | cat -v)
stty "$old_stty"
if [[ "$response" == *"[>41;354;0c"* ]]; then
    echo -e "${GREEN}PASS${NC}"
    echo "  Response: $response"
    echo "  Decoded: xterm-like terminal (41), version 354"
else
    echo -e "${RED}FAIL${NC}"
    echo "  Expected: ^[[>41;354;0c"
    echo "  Got: $response"
fi

echo ""

# Test DSR (Device Status Report)
echo -n "Testing DSR Status (CSI 5 n): "
old_stty=$(stty -g)
stty raw -echo min 0 time 10
printf '\033[5n'
response=$(dd bs=1 count=50 2>/dev/null | cat -v)
stty "$old_stty"
if [[ "$response" == *"[0n"* ]]; then
    echo -e "${GREEN}PASS${NC}"
    echo "  Response: $response"
    echo "  Decoded: Terminal OK"
else
    echo -e "${RED}FAIL${NC}"
    echo "  Expected: ^[[0n"
    echo "  Got: $response"
fi

echo ""

# Test CPR (Cursor Position Report)
echo -n "Testing CPR (CSI 6 n): "
old_stty=$(stty -g)
stty raw -echo min 0 time 10
printf '\033[6n'
response=$(dd bs=1 count=50 2>/dev/null | cat -v)
stty "$old_stty"
if [[ "$response" =~ \[([0-9]+)\;([0-9]+)R ]]; then
    echo -e "${GREEN}PASS${NC}"
    echo "  Response: $response"
    echo "  Decoded: Cursor at row ${BASH_REMATCH[1]}, col ${BASH_REMATCH[2]}"
else
    echo -e "${RED}FAIL${NC}"
    echo "  Expected: ^[[<row>;<col>R"
    echo "  Got: $response"
fi

echo ""
echo "--- Mode Tests ---"
echo ""

# Test Cursor Blink Mode
echo "Testing Cursor Blink Mode (CSI ? 12 h/l):"
echo "  Disabling cursor blink..."
printf '\033[?12l'
echo -e "  ${YELLOW}Cursor should now be STEADY (not blinking)${NC}"
echo "  Press Enter to continue..."
read -r

echo "  Enabling cursor blink..."
printf '\033[?12h'
echo -e "  ${YELLOW}Cursor should now be BLINKING${NC}"
echo "  Press Enter to continue..."
read -r

echo -e "  ${GREEN}Cursor blink mode test complete${NC}"
echo ""

echo "--- OSC Color Tests ---"
echo ""

# Test OSC 10 - Query foreground color
echo -n "Testing OSC 10 Query (foreground color): "
old_stty=$(stty -g)
stty raw -echo min 0 time 10
printf '\033]10;?\033\\'
response=$(dd bs=1 count=50 2>/dev/null | cat -v)
stty "$old_stty"
if [[ "$response" == *"]10;rgb:"* ]]; then
    echo -e "${GREEN}PASS${NC}"
    echo "  Response: $response"
else
    echo -e "${RED}FAIL${NC}"
    echo "  Expected: contains ]10;rgb:"
    echo "  Got: $response"
fi

echo ""

# Test OSC 11 - Query background color
echo -n "Testing OSC 11 Query (background color): "
old_stty=$(stty -g)
stty raw -echo min 0 time 10
printf '\033]11;?\033\\'
response=$(dd bs=1 count=50 2>/dev/null | cat -v)
stty "$old_stty"
if [[ "$response" == *"]11;rgb:"* ]]; then
    echo -e "${GREEN}PASS${NC}"
    echo "  Response: $response"
else
    echo -e "${RED}FAIL${NC}"
    echo "  Expected: contains ]11;rgb:"
    echo "  Got: $response"
fi

echo ""

# Test OSC 12 - Query cursor color (default)
echo -n "Testing OSC 12 Query (cursor color, default): "
old_stty=$(stty -g)
stty raw -echo min 0 time 10
printf '\033]12;?\033\\'
response=$(dd bs=1 count=50 2>/dev/null | cat -v)
stty "$old_stty"
if [[ "$response" == *"]12;rgb:"* ]]; then
    echo -e "${GREEN}PASS${NC}"
    echo "  Response: $response"
else
    echo -e "${RED}FAIL${NC}"
    echo "  Expected: contains ]12;rgb:"
    echo "  Got: $response"
fi

echo ""

echo "--- Interactive Cursor Color Tests (BLINKING) ---"
echo ""

# Enable cursor blink first
echo "Enabling cursor blink (CSI ? 12 h)..."
printf '\033[?12h'
echo ""

# Interactive test: Set cursor to RED (blinking)
echo "Testing BLINKING Cursor Color (OSC 12):"
echo "  Setting cursor color to RED..."
printf '\033]12;#ff0000\033\\'
echo -e "  ${YELLOW}Cursor should now be RED and BLINKING${NC}"
echo "  Press Enter to continue..."
read -r

# Interactive test: Set cursor to GREEN (blinking)
echo "  Setting cursor color to GREEN..."
printf '\033]12;#00ff00\033\\'
echo -e "  ${YELLOW}Cursor should now be GREEN and BLINKING${NC}"
echo "  Press Enter to continue..."
read -r

# Interactive test: Set cursor to BLUE (blinking)
echo "  Setting cursor color to BLUE..."
printf '\033]12;#0000ff\033\\'
echo -e "  ${YELLOW}Cursor should now be BLUE and BLINKING${NC}"
echo "  Press Enter to continue..."
read -r

echo -e "  ${GREEN}Blinking cursor color test complete${NC}"
echo ""

echo "--- Interactive Cursor Color Tests (STEADY) ---"
echo ""

# Disable cursor blink
echo "Disabling cursor blink (CSI ? 12 l)..."
printf '\033[?12l'
echo ""

# Interactive test: Set cursor to RED (steady)
echo "Testing STEADY Cursor Color (OSC 12):"
echo "  Setting cursor color to RED..."
printf '\033]12;#ff0000\033\\'
echo -e "  ${YELLOW}Cursor should now be RED and STEADY (not blinking)${NC}"
echo "  Press Enter to continue..."
read -r

# Interactive test: Set cursor to GREEN (steady)
echo "  Setting cursor color to GREEN..."
printf '\033]12;#00ff00\033\\'
echo -e "  ${YELLOW}Cursor should now be GREEN and STEADY (not blinking)${NC}"
echo "  Press Enter to continue..."
read -r

# Interactive test: Set cursor to BLUE (steady)
echo "  Setting cursor color to BLUE..."
printf '\033]12;#0000ff\033\\'
echo -e "  ${YELLOW}Cursor should now be BLUE and STEADY (not blinking)${NC}"
echo "  Press Enter to continue..."
read -r

echo -e "  ${GREEN}Steady cursor color test complete${NC}"
echo ""

# Reset cursor color and re-enable blink
echo "Resetting cursor color (OSC 112) and re-enabling blink..."
printf '\033]112\033\\'
printf '\033[?12h'
echo -e "  ${YELLOW}Cursor should now be DEFAULT (white) and BLINKING${NC}"
echo "  Press Enter to continue..."
read -r

echo -e "  ${GREEN}All cursor color tests complete${NC}"
echo ""

echo "--- Automated OSC Color Query Tests ---"
echo ""

# Test OSC 12 Set + Query
echo -n "Testing OSC 12 Set + Query (set cursor to red): "
# Set cursor color to red
printf '\033]12;#ff0000\033\\'
# Query cursor color
old_stty=$(stty -g)
stty raw -echo min 0 time 10
printf '\033]12;?\033\\'
response=$(dd bs=1 count=50 2>/dev/null | cat -v)
stty "$old_stty"
if [[ "$response" == *"]12;rgb:ffff/0000/0000"* ]]; then
    echo -e "${GREEN}PASS${NC}"
    echo "  Response: $response"
    echo "  Decoded: Cursor color set to red"
else
    echo -e "${RED}FAIL${NC}"
    echo "  Expected: contains ]12;rgb:ffff/0000/0000"
    echo "  Got: $response"
fi

echo ""

# Test OSC 112 Reset cursor color
echo -n "Testing OSC 112 Reset (reset cursor color): "
# First set cursor to green
printf '\033]12;#00ff00\033\\'
# Then reset it
printf '\033]112\033\\'
# Query cursor color - should be back to default (white)
old_stty=$(stty -g)
stty raw -echo min 0 time 10
printf '\033]12;?\033\\'
response=$(dd bs=1 count=50 2>/dev/null | cat -v)
stty "$old_stty"
if [[ "$response" == *"]12;rgb:ffff/ffff/ffff"* ]]; then
    echo -e "${GREEN}PASS${NC}"
    echo "  Response: $response"
    echo "  Decoded: Cursor color reset to default (white)"
else
    echo -e "${RED}FAIL${NC}"
    echo "  Expected: contains ]12;rgb:ffff/ffff/ffff (default white)"
    echo "  Got: $response"
fi

echo ""

echo "=== Tests Complete ==="
