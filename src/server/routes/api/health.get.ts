import { eventHandler } from 'h3';

import { getHealthStatus } from '../../services/health.service';

export default eventHandler(() => ({
  ...getHealthStatus(),
  app: 'glossa',
}));
