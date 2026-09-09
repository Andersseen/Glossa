import { eventHandler } from 'h3';

import { sendMe } from '../../../http/auth-http';

export default eventHandler(async (event) => {
  await sendMe(event);
});
