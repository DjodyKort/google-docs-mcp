import type { FastMCP } from 'fastmcp';
import { register as listMessages } from './listMessages.js';
import { register as getMessage } from './getMessage.js';
import { register as sendEmail } from './sendEmail.js';
import { register as trashMessage } from './trashMessage.js';
import { register as modifyMessageLabels } from './modifyMessageLabels.js';
import { register as listLabels } from './listLabels.js';

export function registerGmailTools(server: FastMCP) {
  listMessages(server);
  getMessage(server);
  sendEmail(server);
  trashMessage(server);
  modifyMessageLabels(server);
  listLabels(server);
}
