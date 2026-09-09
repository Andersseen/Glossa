import { eventHandler } from 'h3';

import { sendAuthBoundaryError, sendLogout } from '../../../http/auth-http';

export default eventHandler(async (event) => {
  try {
    await sendLogout(event);
    return;
  } catch (error) {
    return sendAuthBoundaryError(event, error);
  }
});
