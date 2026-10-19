import { useEffect, useRef, useState } from 'react';

import { ChevronDown, FileImage, Loader2 } from '../../../components/icons';
import {
  DEFAULT_PDF_RENDER_FORMAT,
  listPdfRenderProfiles,
  type PdfRenderFormat,
} from '../../../server/pdf-render-shared';

interface ConvertToImageMenuProps {
  /** 转换中的文件 id；非空时整组控件禁用并显示加载态。 */
  busyFileId: string | null;
  /** 当前行的文件 id。 */
  fileId: string;
  /** 点击主按钮或选择某个格式时回调所选格式。 */
  onConvert: (format: PdfRenderFormat) => void;
}

const PROFILES = listPdfRenderProfiles();

/**
 * 「PDF 转图片」入口：主按钮 + 右下角下拉三角。
 *
 * 主按钮沿用既有行为（转 SVG 矢量），下拉菜单提供其余目标格式。
 * 菜单使用 `absolute` 定位在按钮组下方，点击页面任意处或按 Esc 关闭。
 */
export function ConvertToImageMenu({ busyFileId, fileId, onConvert }: ConvertToImageMenuProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const isBusy = busyFileId === fileId;

  // 点击外部或按 Esc 关闭菜单
  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative inline-flex">
      <div className="inline-flex overflow-hidden rounded-lg">
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onConvert(DEFAULT_PDF_RENDER_FORMAT);
          }}
          disabled={isBusy}
          className="px-2 py-2 text-zinc-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors disabled:opacity-50"
          title="Convert Pages to Vector (SVG)"
          aria-label="Convert pages to SVG"
        >
          {isBusy ? <Loader2 className="w-5 h-5 animate-spin" /> : <FileImage className="w-5 h-5" />}
        </button>

        {/* 右下角的下拉三角：分隔线 + 箭头，点击展开格式菜单 */}
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            setOpen(prev => !prev);
          }}
          disabled={isBusy}
          className="pl-1 pr-1.5 pb-1.5 text-zinc-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors disabled:opacity-50 border-l border-zinc-200"
          title="Choose output image format"
          aria-label="Choose output image format"
          aria-haspopup="menu"
          aria-expanded={open}
        >
          <ChevronDown className="w-3 h-3" />
        </button>
      </div>

      {open && (
        <div
          role="menu"
          aria-label="Output image format"
          className="absolute right-0 top-full mt-1 z-30 min-w-[9.5rem] rounded-lg border border-zinc-200 bg-white py-1 shadow-lg"
          onClick={(event) => event.stopPropagation()}
        >
          {PROFILES.map((profile) => (
            <button
              key={profile.format}
              type="button"
              role="menuitem"
              onClick={(event) => {
                event.stopPropagation();
                setOpen(false);
                onConvert(profile.format);
              }}
              className="flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-xs text-zinc-700 hover:bg-indigo-50 hover:text-indigo-700 transition-colors"
            >
              <span>{profile.label}</span>
              {profile.format === DEFAULT_PDF_RENDER_FORMAT && (
                <span className="text-[10px] uppercase tracking-wide text-zinc-400">default</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
