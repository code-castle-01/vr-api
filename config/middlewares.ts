const DEFAULT_CORS_ORIGINS = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:5174',
  'http://127.0.0.1:5174',
];

const normalizeOrigin = (value: unknown) => {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim().replace(/\/$/, '');
};

const resolveAllowedOrigins = (env: { array: (name: string, defaultValue?: string[]) => string[] }) => {
  const configuredOrigins = env
    .array('CORS_ORIGIN', [])
    .map((origin) => normalizeOrigin(origin))
    .filter(Boolean);

  if (!configuredOrigins.length || configuredOrigins.includes('*')) {
    return DEFAULT_CORS_ORIGINS;
  }

  return Array.from(new Set([...DEFAULT_CORS_ORIGINS, ...configuredOrigins]));
};

export default ({ env }) => [
  'strapi::logger',
  'strapi::errors',
  {
    name: 'strapi::security',
    config: {
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          'connect-src': ["'self'", 'https:'],
          'img-src': [
            "'self'",
            'data:',
            'blob:',
            'https://market-assets.strapi.io',
            'https://res.cloudinary.com',
            'https://console.cloudinary.com',
          ],
          'media-src': [
            "'self'",
            'data:',
            'blob:',
            'https://res.cloudinary.com',
            'https://console.cloudinary.com',
          ],
          'script-src': [
            "'self'",
            'https://media-library.cloudinary.com',
            'https://upload-widget.cloudinary.com',
            'https://console.cloudinary.com',
          ],
          'frame-src': [
            "'self'",
            'https://media-library.cloudinary.com',
            'https://upload-widget.cloudinary.com',
            'https://console.cloudinary.com',
          ],
          upgradeInsecureRequests: null,
        },
      },
    },
  },
  {
    name: 'strapi::cors',
    config: {
      origin: resolveAllowedOrigins(env),
      methods: ['GET', 'HEAD', 'PUT', 'POST', 'DELETE', 'PATCH', 'OPTIONS'],
      headers: ['Content-Type', 'Authorization', 'Origin', 'Accept'],
      credentials: true,
      keepHeadersOnError: true,
    },
  },
  'strapi::poweredBy',
  'strapi::query',
  'strapi::body',
  'strapi::session',
  {
    resolve: './src/middlewares/resident-access-guard',
  },
  'strapi::favicon',
  'strapi::public',
];
