"""サイト共通の OG 画像（1200x630）を生成する。ビルド対象外の手動ツール。

使い方: python3 scripts/make-og.py [出力先]   （既定: static/images/og-v1.png）
依存: Pillow と macOS 標準の Helvetica Neue。Vercel のビルドでは実行しない。
X はカード画像を数日キャッシュするため、デザインを変えたら出力名の版（og-v2.png 等）を上げ、
scripts/build.mjs の OG_IMAGE も合わせて書き換えること。
"""
import sys

from PIL import Image, ImageDraw, ImageFont

W, H = 1200, 630
BG = "#1a1a1a"  # favicon.svg と同じ地色
INK = "#ffffff"
MUTED = "#8b8b8b"  # style.css のダークモード footer 色
FONT = "/System/Library/Fonts/HelveticaNeue.ttc"
BOLD, REGULAR = 1, 0

# favicon.svg の "H" の輪郭（viewBox 64x64）
H_PATH = [(18, 14), (27, 14), (27, 29), (37, 29), (37, 14), (46, 14), (46, 50),
          (37, 50), (37, 37), (27, 37), (27, 50), (18, 50)]


def draw_mark(draw: ImageDraw.ImageDraw, x: int, y: int, size: int) -> None:
    """favicon と同じ角丸正方形＋H を描く。地色と同色だと消えるので枠線で縁取る。"""
    s = size / 64
    draw.rounded_rectangle((x, y, x + size, y + size), radius=round(12 * s),
                           fill="#262626", outline="#3a3a3a", width=2)
    draw.polygon([(x + px * s, y + py * s) for px, py in H_PATH], fill=INK)


def main() -> None:
    out = sys.argv[1] if len(sys.argv) > 1 else "static/images/og-v1.png"
    img = Image.new("RGB", (W, H), BG)
    draw = ImageDraw.Draw(img)

    # X が画像下部に見出しを重ねる場合に備え、下 1/5（y >= 504）には何も置かない
    mark = 150
    name_font = ImageFont.truetype(FONT, 96, index=BOLD)
    domain_font = ImageFont.truetype(FONT, 40, index=REGULAR)
    gap = 48
    name_w = draw.textlength("Hibiki Hata", font=name_font)
    block_w = mark + gap + name_w
    x0 = round((W - block_w) / 2)
    cy = 252  # 上 4/5 の中心

    draw_mark(draw, x0, cy - mark // 2, mark)
    tx = x0 + mark + gap
    draw.text((tx, cy - 8), "Hibiki Hata", font=name_font, fill=INK, anchor="ls")
    draw.text((tx + 4, cy + 56), "hibikihata.com", font=domain_font, fill=MUTED, anchor="ls")

    img.save(out, optimize=True)
    print(out)


if __name__ == "__main__":
    main()
