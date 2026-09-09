import { eventHandler } from 'h3';

import { sendLogout } from '../../../http/auth-http';

export default eventHandler(async (event) => {
  await sendLogout(event);
});
