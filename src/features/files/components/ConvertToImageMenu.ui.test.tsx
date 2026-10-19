import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_PDF_RENDER_FORMAT, listPdfRenderProfiles } from '../../../server/pdf-render-shared';
import { ConvertToImageMenu } from './ConvertToImageMenu';

const FORMATS = listPdfRenderProfiles();

describe('ConvertToImageMenu — 布局与默认行为', () => {
  it('渲染主按钮 + 右下角下拉三角两个独立按钮', () => {
    render(<ConvertToImageMenu busyFileId={null} fileId="pdf-1" onConvert={vi.fn()} />);

    // 主按钮：保持既有的 SVG 转换入口
    const main = screen.getByRole('button', { name: 'Convert pages to SVG' });
    expect(main).toBeInTheDocument();
    expect(main).toHaveAttribute('title', 'Convert Pages to Vector (SVG)');

    // 下拉三角：紧邻主按钮，带 aria-haspopup
    const toggle = screen.getByRole('button', { name: 'Choose output image format' });
    expect(toggle).toHaveAttribute('aria-haspopup', 'menu');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    // 二者在同一个按钮组容器内（视觉上是分裂式按钮）
    const group = main.parentElement;
    expect(group).not.toBeNull();
    expect(within(group as HTMLElement).getByRole('button', { name: 'Choose output image format' })).toBe(toggle);
  });

  it('默认不展开菜单', () => {
    render(<ConvertToImageMenu busyFileId={null} fileId="pdf-1" onConvert={vi.fn()} />);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('点击主按钮走默认 SVG 格式', async () => {
    const user = userEvent.setup();
    const onConvert = vi.fn();
    render(<ConvertToImageMenu busyFileId={null} fileId="pdf-1" onConvert={onConvert} />);

    await user.click(screen.getByRole('button', { name: 'Convert pages to SVG' }));

    expect(onConvert).toHaveBeenCalledTimes(1);
    expect(onConvert).toHaveBeenCalledWith(DEFAULT_PDF_RENDER_FORMAT);
    expect(onConvert).toHaveBeenCalledWith('svg');
  });

  it('转换进行中时两个按钮都禁用', () => {
    render(<ConvertToImageMenu busyFileId="pdf-1" fileId="pdf-1" onConvert={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Convert pages to SVG' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Choose output image format' })).toBeDisabled();
  });

  it('其他文件转换中时本行按钮仍可用', () => {
    render(<ConvertToImageMenu busyFileId="pdf-2" fileId="pdf-1" onConvert={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Convert pages to SVG' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Choose output image format' })).toBeEnabled();
  });
});

describe('ConvertToImageMenu — 下拉菜单内容', () => {
  it('列出全部受支持格式，且至少含 PNG / JPG / JPEG / SVG', async () => {
    const user = userEvent.setup();
    render(<ConvertToImageMenu busyFileId={null} fileId="pdf-1" onConvert={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Choose output image format' }));

    const items = within(screen.getByRole('menu')).getAllByRole('menuitem');
    expect(items).toHaveLength(FORMATS.length);

    const labels = items.map((item) => item.textContent ?? '');
    // 任务明确要求的四种
    for (const required of ['svg', 'png', 'jpg', 'jpeg'] as const) {
      expect(FORMATS.some((p) => p.format === required), `注册表缺少 ${required}`).toBe(true);
    }
    // 任务点名「补充其他最常见图片格式」
    for (const extra of ['webp', 'bmp', 'tiff', 'gif'] as const) {
      const profile = FORMATS.find((p) => p.format === extra);
      expect(profile, `注册表缺少 ${extra}`).toBeDefined();
      expect(labels.join(' '), `菜单里找不到 ${extra}`).toContain(profile!.label);
    }
  });

  it('SVG 项标注为 default，且只有它带该标注', async () => {
    const user = userEvent.setup();
    render(<ConvertToImageMenu busyFileId={null} fileId="pdf-1" onConvert={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Choose output image format' }));

    const items = within(screen.getByRole('menu')).getAllByRole('menuitem');
    const svgItem = items.find((item) => item.textContent?.includes('SVG'));
    expect(svgItem).toBeDefined();
    expect(svgItem!.textContent).toContain('default');

    const withDefault = items.filter((item) => item.textContent?.includes('default'));
    expect(withDefault).toHaveLength(1);
  });

  it('展开后 aria-expanded 变为 true，再次点击收起', async () => {
    const user = userEvent.setup();
    render(<ConvertToImageMenu busyFileId={null} fileId="pdf-1" onConvert={vi.fn()} />);

    const toggle = screen.getByRole('button', { name: 'Choose output image format' });

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('menu')).toBeInTheDocument();

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});

describe('ConvertToImageMenu — 选择格式', () => {
  it.each(FORMATS.map((p) => [p.format, p.label] as const))(
    '选择 %s 时以该格式回调，并在选择后收起菜单',
    async (format, label) => {
      const user = userEvent.setup();
      const onConvert = vi.fn();
      render(<ConvertToImageMenu busyFileId={null} fileId="pdf-1" onConvert={onConvert} />);

      await user.click(screen.getByRole('button', { name: 'Choose output image format' }));
      const menu = screen.getByRole('menu');
      const item = within(menu).getAllByRole('menuitem').find((el) => el.textContent?.includes(label));
      expect(item, `菜单里找不到 ${label}`).toBeDefined();

      await user.click(item!);

      expect(onConvert).toHaveBeenCalledTimes(1);
      expect(onConvert).toHaveBeenCalledWith(format);
      await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
    },
  );

  it('选择非默认格式时不会误触发 SVG', async () => {
    const user = userEvent.setup();
    const onConvert = vi.fn();
    render(<ConvertToImageMenu busyFileId={null} fileId="pdf-1" onConvert={onConvert} />);

    await user.click(screen.getByRole('button', { name: 'Choose output image format' }));
    const pngItem = within(screen.getByRole('menu'))
      .getAllByRole('menuitem')
      .find((el) => el.textContent?.trim().startsWith('PNG'));
    await user.click(pngItem!);

    expect(onConvert).toHaveBeenCalledWith('png');
    expect(onConvert).not.toHaveBeenCalledWith('svg');
  });
});

describe('ConvertToImageMenu — 关闭交互', () => {
  it('点击菜单外部关闭菜单', async () => {
    const user = userEvent.setup();
    render(
      <div>
        <ConvertToImageMenu busyFileId={null} fileId="pdf-1" onConvert={vi.fn()} />
        <button type="button">页面其他控件</button>
      </div>,
    );

    await user.click(screen.getByRole('button', { name: 'Choose output image format' }));
    expect(screen.getByRole('menu')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '页面其他控件' }));
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
  });

  it('按 Esc 关闭菜单', async () => {
    const user = userEvent.setup();
    render(<ConvertToImageMenu busyFileId={null} fileId="pdf-1" onConvert={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Choose output image format' }));
    expect(screen.getByRole('menu')).toBeInTheDocument();

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
  });

  it('关闭菜单不应触发转换回调', async () => {
    const user = userEvent.setup();
    const onConvert = vi.fn();
    render(
      <div>
        <ConvertToImageMenu busyFileId={null} fileId="pdf-1" onConvert={onConvert} />
        <button type="button">页面其他控件</button>
      </div>,
    );

    await user.click(screen.getByRole('button', { name: 'Choose output image format' }));
    await user.click(screen.getByRole('button', { name: '页面其他控件' }));
    await user.keyboard('{Escape}');

    expect(onConvert).not.toHaveBeenCalled();
  });

  it('菜单内的点击不会冒泡到外层（避免触发行选择等父级行为）', async () => {
    const user = userEvent.setup();
    const onRowClick = vi.fn();
    const onConvert = vi.fn();

    render(
      // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
      <div onClick={onRowClick}>
        <ConvertToImageMenu busyFileId={null} fileId="pdf-1" onConvert={onConvert} />
      </div>,
    );

    await user.click(screen.getByRole('button', { name: 'Choose output image format' }));
    expect(onRowClick).not.toHaveBeenCalled();

    const pngItem = within(screen.getByRole('menu'))
      .getAllByRole('menuitem')
      .find((el) => el.textContent?.trim().startsWith('PNG'));
    await user.click(pngItem!);

    expect(onConvert).toHaveBeenCalledWith('png');
    expect(onRowClick, '菜单项点击不应冒泡到行容器').not.toHaveBeenCalled();
  });

  it('主按钮点击也不冒泡到外层', async () => {
    const user = userEvent.setup();
    const onRowClick = vi.fn();

    render(
      // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
      <div onClick={onRowClick}>
        <ConvertToImageMenu busyFileId={null} fileId="pdf-1" onConvert={vi.fn()} />
      </div>,
    );

    await user.click(screen.getByRole('button', { name: 'Convert pages to SVG' }));
    expect(onRowClick).not.toHaveBeenCalled();
  });
});
