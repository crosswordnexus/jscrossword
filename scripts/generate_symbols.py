import os
import io
import base64
from PIL import Image, ImageDraw, ImageFont

import platform

# Define the symbols you want to convert to inline PNG images
SYMBOLS = ['∀', '∈', 'Ω', '≥']
# Generated font size. Bigger looks better, smaller results in smaller file size
FONT_SIZE = 36

# Determine font path based on operating system
def get_system_font():
    system = platform.system()

    if system == "Darwin":  # macOS
        paths = [
            '/System/Library/Fonts/Supplemental/Arial Unicode.ttf',
            '/System/Library/Fonts/LucidaGrande.ttc',
            '/System/Library/Fonts/Helvetica.ttc',
            '/System/Library/Fonts/Times.dfont'
        ]
    elif system == "Windows":
        windir = os.environ.get('WINDIR', 'C:\\Windows')
        paths = [
            os.path.join(windir, 'Fonts', 'arial.ttf'),
            os.path.join(windir, 'Fonts', 'segoeui.ttf'),
            os.path.join(windir, 'Fonts', 'micross.ttf')  # MS Sans Serif
        ]
    else:  # Linux / Unix
        paths = [
            '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
            '/usr/share/fonts/truetype/freefont/FreeSans.ttf',
            '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
            '/usr/share/fonts/truetype/msttcorefonts/Arial.ttf'
        ]

    for p in paths:
        if os.path.exists(p):
            return p
    return None

font_path = get_system_font()

if not font_path:
    print("Warning: No system font found. Defaulting PIL font rendering.")

print(f"Using font: {font_path}")

def make_png(text):
    # Draw at a moderate size (48pt) to keep base64 strings compact
    img = Image.new('RGBA', (100, 100), (255, 255, 255, 0))
    draw = ImageDraw.Draw(img)
    font = ImageFont.truetype(font_path, FONT_SIZE)

    # Calculate bounding box
    bbox = draw.textbbox((0, 0), text, font=font)
    w = bbox[2] - bbox[0]
    h = bbox[3] - bbox[1]

    # Draw text shifted so it starts exactly at (0, 0)
    draw.text((-bbox[0], -bbox[1]), text, fill=(0, 0, 0, 255), font=font)

    # Crop to the actual bounding box
    cropped = img.crop((0, 0, w, h))

    # Pad to a square, leaving 12.5% breathing room/padding on all sides
    # so the symbol matches the text height instead of touching the edges.
    max_dim = max(w, h)
    padding = int(max_dim * 0.125)
    canvas_size = max_dim + 2 * padding

    square_img = Image.new('RGBA', (canvas_size, canvas_size), (255, 255, 255, 0))
    square_img.paste(cropped, ((canvas_size - w) // 2, (canvas_size - h) // 2))

    # Convert to Grayscale + Alpha (LA) to reduce color channels and optimize PNG compression
    la_img = square_img.convert('LA')

    output = io.BytesIO()
    la_img.save(output, format='PNG', optimize=True)
    return base64.b64encode(output.getvalue()).decode('utf-8')

# Generate the JS file content
dict_entries = ",\n".join([f"  '{sym}': 'data:image/png;base64,{make_png(sym)}'" for sym in SYMBOLS])

content = f"""// Inline base64 PNG images for Unicode math and Greek characters.
// This allows rendering them in PDFs without embedding large font files.
export const symbolImages = {{
{dict_entries}
}};
"""

# Write it directly to the target file
script_dir = os.path.dirname(os.path.abspath(__file__))
target_path = os.path.normpath(os.path.join(script_dir, '../src/lib/symbol_images.js'))
with open(target_path, 'w', encoding='utf-8') as fh:
    fh.write(content)

print(f"Successfully generated symbols {SYMBOLS} in {target_path} (lower resolution with padding)")
