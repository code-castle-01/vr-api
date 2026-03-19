import {
  getResidentAccessConfig,
  isResidentSessionRevoked,
  isResidentSessionToken,
} from '../utils/resident-access';
import { getJwtService } from '../utils/resident-session';

export default (_config: unknown, { strapi }: { strapi: any }) => {
  return async (ctx: any, next: () => Promise<void>) => {
    if (typeof ctx.request?.path === 'string' && ctx.request.path.startsWith('/admin')) {
      return next();
    }

    const authorizationHeader = ctx.request?.header?.authorization;

    if (
      typeof authorizationHeader !== 'string' ||
      !authorizationHeader.toLowerCase().startsWith('bearer ')
    ) {
      return next();
    }

    let tokenPayload: Record<string, unknown> | null = null;

    try {
      tokenPayload = (await getJwtService(strapi).getToken(ctx)) as
        | Record<string, unknown>
        | null;
    } catch {
      return next();
    }

    if (!isResidentSessionToken(tokenPayload)) {
      return next();
    }

    const residentAccessConfig = await getResidentAccessConfig(strapi);

    if (
      !residentAccessConfig.residentLoginEnabled ||
      isResidentSessionRevoked(tokenPayload, residentAccessConfig)
    ) {
      return ctx.unauthorized(
        residentAccessConfig.residentLoginDisabledMessage
      );
    }

    return next();
  };
};
