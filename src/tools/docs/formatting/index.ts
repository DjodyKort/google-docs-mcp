import type { FastMCP } from 'fastmcp';

import { register as applyTextStyle } from './applyTextStyle.js';
import { register as applyParagraphStyle } from './applyParagraphStyle.js';
import { register as updateTableCellStyle } from './updateTableCellStyle.js';
import { register as updateTableBorders } from './updateTableBorders.js';
import { register as updateTableColumnWidth } from './updateTableColumnWidth.js';
import { register as updateTableRowStyle } from './updateTableRowStyle.js';
import { register as formatTableCells } from './formatTableCells.js';
import { register as formatTableRows } from './formatTableRows.js';
import { register as formatTableColumns } from './formatTableColumns.js';
import { register as updateDocumentStyle } from './updateDocumentStyle.js';
import { register as updateSectionStyle } from './updateSectionStyle.js';
import { register as createParagraphBullets } from './createParagraphBullets.js';
import { register as deleteParagraphBullets } from './deleteParagraphBullets.js';

export function registerFormattingTools(server: FastMCP) {
  applyTextStyle(server);
  applyParagraphStyle(server);
  updateTableCellStyle(server);
  updateTableBorders(server);
  updateTableColumnWidth(server);
  updateTableRowStyle(server);
  formatTableCells(server);
  formatTableRows(server);
  formatTableColumns(server);
  updateDocumentStyle(server);
  updateSectionStyle(server);
  createParagraphBullets(server);
  deleteParagraphBullets(server);
}
