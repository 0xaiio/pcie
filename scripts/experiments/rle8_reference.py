"""独立 RLE8 参考解码器 —— 只用 BMP 规范，不依赖任何第三方库。

用途：为自研编码器建立可信的 ground truth。Pillow 在本用例上表现异常
（行 0..699 全 0、行 700..791 正确），需要先确认是编码器错还是解码器有分歧。

RLE8 编码（BI_RLE8）语义：
  (count>0, value)      游程：count 个 value（count 上限 255）
  (0, 0)               EOL：行结束
  (0, 1)               EOB：位图结束
  (0, 2, dx, dy)       DELTA：跳过 dx 列 dy 行
  (0, n>=3) + n 字节    绝对模式：n 个字面像素（本编码器令 n 恒为偶数）

biHeight 为正 -> 像素自下而上存储 -> 流首行 = 位图最底行。

运行：python rle8_reference.py <meta.json>
"""
import json
import os
import sys

meta = json.load(open(sys.argv[1], "r", encoding="utf-8"))
out_dir = os.path.dirname(sys.argv[1])
W, H, C = meta["width"], meta["height"], meta["channels"]

CUBE_STEPS, CUBE_MAX = 6, 5
q = lambda v: min(CUBE_MAX, (v * CUBE_MAX + 127) // 255)

raw = open(os.path.join(out_dir, "page.rgb"), "rb").read()
assert len(raw) == W * H * C, (len(raw), W * H * C)

src = bytearray(W * H)
for i in range(W * H):
    p = i * C
    src[i] = q(raw[p]) * CUBE_STEPS * CUBE_STEPS + q(raw[p + 1]) * CUBE_STEPS + q(raw[p + 2])

bmp = open(os.path.join(out_dir, "page.bmp"), "rb").read()
assert bmp[:2] == b"BM"
off = int.from_bytes(bmp[10:14], "little")
fw = int.from_bytes(bmp[18:22], "little", signed=True)
fh = int.from_bytes(bmp[22:26], "little", signed=True)
bpp = int.from_bytes(bmp[28:30], "little")
comp = int.from_bytes(bmp[30:34], "little")
isz = int.from_bytes(bmp[34:38], "little")
print(f"file={len(bmp)} dataOff={off} {fw}x{fh} bpp={bpp} comp={comp} imgSize={isz}")
assert (fw, fh) == (W, H), "尺寸不符"
assert bpp == 8 and comp == 1
assert off + isz == len(bmp), f"像素数据未铺满文件：{off}+{isz}={off+isz} vs {len(bmp)}"

s = bmp[off : off + isz]
print(f"stream={len(s)}  4字节对齐={len(s) % 4 == 0}")

bottom_up = fh > 0
dec = bytearray(W * H)
pos = 0
row = 0              # 已完成的行数
col = 0              # 当前行内已写入的像素数
stats = {"run": 0, "abs": 0, "eol": 0, "delta": 0}
eob = False
error = None

def dst_row(r):
    """流中第 r 行 -> 图像第 r 行（biHeight>0 时自下而上）。"""
    return (H - 1 - r) if bottom_up else r

while pos < len(s) and not eob:
    n = s[pos]
    v = s[pos + 1] if pos + 1 < len(s) else None
    if v is None:
        error = f"@{pos} 截断：缺少第二个字节"
        break

    if n > 0:                                        # 游程
        pos += 2
        stats["run"] += 1
        if row >= H:
            error = f"@{pos} 行数超出：row={row} > H={H}"
            break
        base = dst_row(row) * W
        if col + n > W:
            error = f"@{pos} 行溢出：col={col} + n={n} > W={W} (row={row})"
            break
        for k in range(n):
            dec[base + col + k] = v
        col += n
    elif v == 0:                                      # EOL
        pos += 2
        stats["eol"] += 1
        if col != W:
            error = f"@{pos} EOL 时该行只写了 {col}/{W} 像素"
        row += 1
        col = 0
    elif v == 1:                                      # EOB
        pos += 2
        eob = True
    elif v == 2:                                      # DELTA: 00 02 dx dy —— 共 4 字节
        pos += 4
        stats["delta"] += 1
    else:                                             # 绝对模式（v >= 3）
        cnt = v
        if cnt % 2 != 0:
            error = f"@{pos} 绝对模式 n={cnt} 为奇数（本编码器应恒为偶数）"
            break
        if pos + 2 + cnt > len(s):
            error = f"@{pos} 绝对模式数据越界：需 {cnt} 字节"
            break
        pos += 2
        stats["abs"] += 1
        if row >= H:
            error = f"@{pos} 行数超出：row={row}"
            break
        base = dst_row(row) * W
        if col + cnt > W:
            error = f"@{pos} 绝对模式行溢出：col={col} + {cnt} > W={W} (row={row})"
            break
        dec[base + col : base + col + cnt] = s[pos : pos + cnt]
        col += cnt
        pos += cnt

print(f"解码统计: {stats}")
print(f"行数={row}/{H}  EOB={eob}  pos={pos}/{len(s)}  尾随字节={len(s)-pos}")
if error:
    print(f"!! 结构错误: {error}")

mism = [i for i in range(W * H) if dec[i] != src[i]]
print(f"\n参考解码 vs 源: {W*H-len(mism)}/{W*H} 精确 ({100*len(mism)/(W*H):.2f}% 失配)")
if mism:
    i = mism[0]
    print(f"首个失配 (x={i % W}, y={i // W}): got={dec[i]} expected={src[i]}")

ok = (not error) and eob and row == H and not mism
print("\n参考解码器判定:", "PASS" if ok else "FAIL")
sys.exit(0 if ok else 1)
