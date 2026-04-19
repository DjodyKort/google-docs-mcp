import type { FastMCP } from 'fastmcp';

// Core read/write
import { register as readGoogleDoc } from './readGoogleDoc.js';
import { register as listDocumentTabs } from './listDocumentTabs.js';
import { register as renameTab } from './renameTab.js';
import { register as addTab } from './addTab.js';
import { register as appendToGoogleDoc } from './appendToGoogleDoc.js';
import { register as insertText } from './insertText.js';
import { register as deleteRange } from './deleteRange.js';
import { register as modifyText } from './modifyText.js';
import { register as findAndReplace } from './findAndReplace.js';
import { register as findElement } from './findElement.js';
import { register as replaceAllText } from './replaceAllText.js';
import { register as findText } from './findText.js';

// Structure
import { register as insertTable } from './insertTable.js';
import { register as insertTableWithData } from './insertTableWithData.js';
import { register as insertPageBreak } from './insertPageBreak.js';
import { register as insertSectionBreak } from './insertSectionBreak.js';
import { register as insertImage } from './insertImage.js';
import { register as insertDateChip } from './insertDateChip.js';
import { register as insertPerson } from './insertPerson.js';
import { register as insertRichLink } from './insertRichLink.js';
import { register as listSmartChips } from './listSmartChips.js';
import { register as cloneTable } from './cloneTable.js';
import { register as listDocumentTables } from './listDocumentTables.js';
import { register as getTableStructure } from './getTableStructure.js';
import { register as findSectionsByHeading } from './findSectionsByHeading.js';
import { register as replaceTableRowData } from './replaceTableRowData.js';
import { register as appendTableRows } from './appendTableRows.js';
import { register as deleteTableRows } from './deleteTableRows.js';

// Table structure operations
import { register as mergeTableCells } from './mergeTableCells.js';
import { register as unmergeTableCells } from './unmergeTableCells.js';
import { register as pinTableHeaderRows } from './pinTableHeaderRows.js';
import { register as insertTableRow } from './insertTableRow.js';
import { register as deleteTableRow } from './deleteTableRow.js';
import { register as insertTableColumn } from './insertTableColumn.js';
import { register as deleteTableColumn } from './deleteTableColumn.js';

// Headers, footers, footnotes
import { register as createHeader } from './createHeader.js';
import { register as createFooter } from './createFooter.js';
import { register as deleteHeader } from './deleteHeader.js';
import { register as deleteFooter } from './deleteFooter.js';
import { register as createFootnote } from './createFootnote.js';

// Images
import { register as replaceImage } from './replaceImage.js';
import { register as downloadImages } from './downloadImages.js';

// Named ranges
import {
  registerCreateNamedRange,
  registerDeleteNamedRange,
  registerReplaceNamedRangeContent,
} from './namedRanges.js';

// Positioned objects
import { register as deletePositionedObject } from './deletePositionedObject.js';

// Tab management
import {
  registerAddTab,
  registerDeleteTab,
  registerUpdateTabProperties,
} from './tabManagement.js';

// Sub-domains
import { registerCommentTools } from './comments/index.js';
import { registerFormattingTools } from './formatting/index.js';

export function registerDocsTools(server: FastMCP) {
  // Core read/write
  readGoogleDoc(server);
  listDocumentTabs(server);
  renameTab(server);
  addTab(server);
  appendToGoogleDoc(server);
  insertText(server);
  deleteRange(server);
  modifyText(server);
  findAndReplace(server);
  findElement(server);
  replaceAllText(server);
  findText(server);

  // Structure
  insertTable(server);
  insertTableWithData(server);
  insertPageBreak(server);
  insertSectionBreak(server);
  insertImage(server);
  insertDateChip(server);
  insertPerson(server);
  insertRichLink(server);
  listSmartChips(server);
  cloneTable(server);
  listDocumentTables(server);
  getTableStructure(server);
  findSectionsByHeading(server);
  replaceTableRowData(server);
  appendTableRows(server);
  deleteTableRows(server);

  // Table structure operations
  mergeTableCells(server);
  unmergeTableCells(server);
  pinTableHeaderRows(server);
  insertTableRow(server);
  deleteTableRow(server);
  insertTableColumn(server);
  deleteTableColumn(server);

  // Headers, footers, footnotes
  createHeader(server);
  createFooter(server);
  deleteHeader(server);
  deleteFooter(server);
  createFootnote(server);

  // Images
  replaceImage(server);
  downloadImages(server);

  // Named ranges
  registerCreateNamedRange(server);
  registerDeleteNamedRange(server);
  registerReplaceNamedRangeContent(server);

  // Positioned objects
  deletePositionedObject(server);

  // Tab management
  registerAddTab(server);
  registerDeleteTab(server);
  registerUpdateTabProperties(server);

  // Sub-domains
  registerFormattingTools(server);
  registerCommentTools(server);
}
