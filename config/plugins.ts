import path from 'path';

const normalizeRateLimitPart = (value: unknown, fallback: string) => {
  if (typeof value !== 'string') {
    return fallback;
  }

  const trimmedValue = value.trim().toLowerCase();

  if (!trimmedValue) {
    return fallback;
  }

  return trimmedValue.replace(/\s+/g, '-');
};

export default ({ env }) => ({
  'users-permissions': {
    config: {
      ratelimit: {
        enabled: env.bool('UP_RATE_LIMIT_ENABLED', true),
        interval: env.int('UP_RATE_LIMIT_INTERVAL', 60000),
        max: env.int('UP_RATE_LIMIT_MAX', 30),
        prefixKey: 'up-auth',
        keyGenerator(ctx) {
          const body = ctx.request.body ?? {};
          const identifier = normalizeRateLimitPart(
            body.identifier ?? body.email ?? body.username,
            'anonymous'
          );
          const requestPath = normalizeRateLimitPart(
            typeof ctx.request.path === 'string'
              ? path.normalize(ctx.request.path)
              : '',
            'unknown-path'
          );
          const ipAddress = normalizeRateLimitPart(ctx.request.ip, 'unknown-ip');

          return `up-auth|${requestPath}|${identifier}|${ipAddress}`;
        },
      },
    },
  },
  upload: {
    config:
      env('CLOUDINARY_NAME') && env('CLOUDINARY_KEY') && env('CLOUDINARY_SECRET')
        ? {
            provider: 'cloudinary',
            providerOptions: {
              cloud_name: env('CLOUDINARY_NAME'),
              api_key: env('CLOUDINARY_KEY'),
              api_secret: env('CLOUDINARY_SECRET'),
            },
            actionOptions: {
              upload: {},
              uploadStream: {},
              delete: {},
            },
          }
        : {},
  },
});
