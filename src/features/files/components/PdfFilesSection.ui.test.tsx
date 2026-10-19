import type { ComponentProps } from 'react';

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { AppFile } from '../types';
import { PdfFilesSection } from './PdfFilesSection';

vi.mock('@hello-pangea/dnd', () => ({
  Droppable: ({ children }: { children: (provided: { innerRef: () => void; droppableProps: Record<string, never>; placeholder: null }) => unknown }) => children({
    innerRef: () => undefined,
    droppableProps: {},
    placeholder: null,
  }),
  Draggable: ({ children }: { children: (provided: { innerRef: () => void; draggableProps: Record<string, never>; dragHandleProps: Record<string, never> }, snapshot: { isDragging: boolean }) => unknown }) => children({
    innerRef: () => undefined,
    draggableProps: {},
    dragHandleProps: {},
  }, { isDragging: false }),
}));

function createAppFileFixture(overrides: Partial<AppFile> = {}): AppFile {
  const file = overrides.file ?? new File(['pdf'], overrides.name ?? 'fixture.pdf', {
    type: 'application/pdf',
    lastModified: 100,
  });

  return {
    id: overrides.id ?? 'pdf-1',
    file,
    name: overrides.name ?? file.name,
    size: overrides.size ?? file.size,
    type: overrides.type ?? 'pdf',
    previewUrl: overrides.previewUrl,
  };
}

function createProps(overrides: Partial<ComponentProps<typeof PdfFilesSection>> = {}): ComponentProps<typeof PdfFilesSection> {
  const files = overrides.files ?? [
    createAppFileFixture({ id: 'pdf-1', name: 'contract.pdf', size: 1200 }),
    createAppFileFixture({ id: 'pdf-2', name: 'invoice.pdf', size: 2400 }),
  ];

  return {
    files,
    selectedIds: overrides.selectedIds ?? new Set(['pdf-2']),
    sortConfig: overrides.sortConfig ?? { key: 'name', order: 'asc' },
    editingFileId: overrides.editingFileId ?? null,
    editingName: overrides.editingName ?? '',
    onEditingNameChange: overrides.onEditingNameChange ?? vi.fn(),
    onCancelEditing: overrides.onCancelEditing ?? vi.fn(),
    onSaveRename: overrides.onSaveRename ?? vi.fn(),
    onStartRename: overrides.onStartRename ?? vi.fn(),
    onToggleAll: overrides.onToggleAll ?? vi.fn(),
    onToggleSelection: overrides.onToggleSelection ?? vi.fn(),
    onSort: overrides.onSort ?? vi.fn(),
    onMove: overrides.onMove ?? vi.fn(),
    onOpenPreview: overrides.onOpenPreview ?? vi.fn(),
    onDuplicate: overrides.onDuplicate ?? vi.fn(),
    onAskAi: overrides.onAskAi ?? vi.fn(),
    onExtractImages: overrides.onExtractImages ?? vi.fn(),
    extractingImagesId: overrides.extractingImagesId ?? null,
    onConvertToVector: overrides.onConvertToVector ?? vi.fn(),
    convertingToImgId: overrides.convertingToImgId ?? null,
    onEditPages: overrides.onEditPages ?? vi.fn(),
    onRemove: overrides.onRemove ?? vi.fn(),
    onDeleteSelected: overrides.onDeleteSelected ?? vi.fn(),
    onCompress: overrides.onCompress ?? vi.fn(),
    isCompressing: overrides.isCompressing ?? false,
    onMergeSelected: overrides.onMergeSelected ?? vi.fn(),
    isMerging: overrides.isMerging ?? false,
  };
}

describe('PdfFilesSection', () => {
  it('routes per-file actions through the provided callbacks', async () => {
    const user = userEvent.setup();
    const props = createProps();

    render(<PdfFilesSection {...props} />);

    const firstRow = screen.getByText('contract.pdf').closest('li');
    expect(firstRow).not.toBeNull();

    const row = within(firstRow as HTMLLIElement);

    await user.click(row.getByTitle('Rename'));
    expect(props.onStartRename).toHaveBeenCalledWith(props.files[0]);

    await user.click(row.getByTitle('Duplicate'));
    expect(props.onDuplicate).toHaveBeenCalledWith(props.files[0]);

    await user.click(row.getByTitle('Move down'));
    expect(props.onMove).toHaveBeenCalledWith('pdf-1', 'down');

    await user.click(row.getByTitle('Preview File'));
    expect(props.onOpenPreview).toHaveBeenCalledWith(props.files[0]);

    await user.click(row.getByTitle('AI Assistant'));
    expect(props.onAskAi).toHaveBeenLastCalledWith([props.files[0]]);

    await user.click(row.getByTitle('Extract Embedded Images (all formats, named by caption)'));
    expect(props.onExtractImages).toHaveBeenCalledWith(props.files[0]);

    await user.click(row.getByTitle('Convert Pages to Vector (SVG)'));
    // 回调的第二个参数是所选输出格式；主按钮对应默认的 SVG
    expect(props.onConvertToVector).toHaveBeenCalledWith(props.files[0], 'svg');

    await user.click(row.getByTitle('Preview & Edit Pages'));
    expect(props.onEditPages).toHaveBeenCalledWith(props.files[0]);

    await user.click(row.getByTitle('Remove file'));
    expect(props.onRemove).toHaveBeenCalledWith('pdf-1');
  });

  it('uses the selected files for bulk actions and routes sorting callbacks', async () => {
    const user = userEvent.setup();
    const props = createProps({ selectedIds: new Set(['pdf-1', 'pdf-2']) });

    render(<PdfFilesSection {...props} />);

    await user.click(screen.getByText('SIZE'));
    expect(props.onSort).toHaveBeenCalledWith('size');

    await user.click(screen.getAllByRole('checkbox')[0]);
    expect(props.onToggleAll).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Ask AI' }));
    expect(props.onAskAi).toHaveBeenLastCalledWith(props.files);

    await user.click(screen.getByRole('button', { name: 'Delete Selected' }));
    expect(props.onDeleteSelected).toHaveBeenCalledTimes(1);

    await user.selectOptions(screen.getByRole('combobox'), 'high');
    expect(props.onCompress).toHaveBeenCalledWith('high');

    await user.click(screen.getByRole('button', { name: 'Merge Selected' }));
    expect(props.onMergeSelected).toHaveBeenCalledTimes(1);
  });

  it('saves inline rename edits with the current file id', async () => {
    const user = userEvent.setup();
    const props = createProps({
      editingFileId: 'pdf-1',
      editingName: 'renamed-contract.pdf',
    });

    render(<PdfFilesSection {...props} />);

    const input = screen.getByDisplayValue('renamed-contract.pdf');
    await user.type(input, '{Enter}');

    expect(props.onSaveRename).toHaveBeenCalledWith('pdf-1');
  });
});

describe('PdfFilesSection — PDF 转图片的格式选择', () => {
  /** 定位某一行的下拉三角按钮。 */
  function dropdownFor(fileName: string) {
    const row = screen.getByText(fileName).closest('li');
    expect(row).not.toBeNull();
    return within(row as HTMLLIElement).getByRole('button', { name: 'Choose output image format' });
  }

  it('每一行都有独立的下拉三角，且默认收起', () => {
    const props = createProps();
    render(<PdfFilesSection {...props} />);

    expect(screen.getAllByRole('button', { name: 'Choose output image format' })).toHaveLength(2);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('从某一行展开菜单并选格式时，只回调该行文件', async () => {
    const user = userEvent.setup();
    const props = createProps();
    render(<PdfFilesSection {...props} />);

    // 在第二行展开并选 PNG
    await user.click(dropdownFor('invoice.pdf'));
    const pngItem = within(screen.getByRole('menu'))
      .getAllByRole('menuitem')
      .find((el) => el.textContent?.trim().startsWith('PNG'));
    expect(pngItem).toBeDefined();
    await user.click(pngItem!);

    expect(props.onConvertToVector).toHaveBeenCalledTimes(1);
    expect(props.onConvertToVector).toHaveBeenCalledWith(props.files[1], 'png');
  });

  it('依次选择不同格式会依次回调对应格式', async () => {
    const user = userEvent.setup();
    const props = createProps();
    // createProps 的兜底是普通函数，这里显式换成 mock 以便读回调用参数
    const onConvertToVector = vi.fn();
    render(<PdfFilesSection {...props} onConvertToVector={onConvertToVector} />);

    for (const label of ['WebP', 'TIFF', 'GIF']) {
      await user.click(dropdownFor('contract.pdf'));
      const item = within(screen.getByRole('menu'))
        .getAllByRole('menuitem')
        .find((el) => el.textContent?.includes(label));
      expect(item, `菜单里找不到 ${label}`).toBeDefined();
      await user.click(item!);
    }

    expect(onConvertToVector.mock.calls.map((call) => call[1])).toEqual(['webp', 'tiff', 'gif']);
  });

  it('从菜单选 SVG 与点主按钮效果一致', async () => {
    const user = userEvent.setup();
    const props = createProps();
    render(<PdfFilesSection {...props} />);

    await user.click(
      within(screen.getByText('contract.pdf').closest('li') as HTMLLIElement)
        .getByTitle('Convert Pages to Vector (SVG)'),
    );
    await user.click(dropdownFor('contract.pdf'));
    const svgItem = within(screen.getByRole('menu'))
      .getAllByRole('menuitem')
      .find((el) => el.textContent?.includes('SVG'));
    await user.click(svgItem!);

    expect(props.onConvertToVector).toHaveBeenCalledTimes(2);
    expect(props.onConvertToVector).toHaveBeenNthCalledWith(1, props.files[0], 'svg');
    expect(props.onConvertToVector).toHaveBeenNthCalledWith(2, props.files[0], 'svg');
  });

  it('转换中该行按钮禁用，其他行不受影响', () => {
    const props = createProps({ convertingToImgId: 'pdf-1' });
    render(<PdfFilesSection {...props} />);

    const firstRow = screen.getByText('contract.pdf').closest('li') as HTMLLIElement;
    const secondRow = screen.getByText('invoice.pdf').closest('li') as HTMLLIElement;

    expect(within(firstRow).getByRole('button', { name: 'Convert pages to SVG' })).toBeDisabled();
    expect(within(firstRow).getByRole('button', { name: 'Choose output image format' })).toBeDisabled();
    expect(within(secondRow).getByRole('button', { name: 'Convert pages to SVG' })).toBeEnabled();
    expect(within(secondRow).getByRole('button', { name: 'Choose output image format' })).toBeEnabled();
  });
});