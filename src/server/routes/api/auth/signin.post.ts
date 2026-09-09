import { eventHandler } from 'h3';

import { sendLogin } from '../../../http/auth-http';

export default eventHandler(async (event) => {
  await sendLogin(event);
});
