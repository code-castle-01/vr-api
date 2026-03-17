import path from 'path';

const parseDatabaseUrl = (value?: string) => {
  if (!value) {
    return {};
  }

  try {
    const parsedUrl = new URL(value);
    const pathname = parsedUrl.pathname.replace(/^\//, '');

    return {
      database: pathname || undefined,
      host: parsedUrl.hostname || undefined,
      password: parsedUrl.password
        ? decodeURIComponent(parsedUrl.password)
        : undefined,
      port: parsedUrl.port ? Number(parsedUrl.port) : undefined,
      user: parsedUrl.username
        ? decodeURIComponent(parsedUrl.username)
        : undefined,
    };
  } catch {
    return {};
  }
};

export default ({ env }) => {
  const fallbackDatabaseUrl = env('MYSQL_URL', env('MYSQL_PUBLIC_URL'));
  const parsedDatabaseUrl = parseDatabaseUrl(env('DATABASE_URL', fallbackDatabaseUrl));
  const fallbackDatabaseHost = env('MYSQLHOST', 'localhost');
  const fallbackDatabasePort = env.int('MYSQLPORT', 3306);
  const fallbackDatabaseName = env('MYSQLDATABASE', 'strapi');
  const fallbackDatabaseUser = env('MYSQLUSER', 'strapi');
  const fallbackDatabasePassword = env('MYSQLPASSWORD', 'strapi');
  const hasMysqlFallback =
    Boolean(env('MYSQLHOST')) ||
    Boolean(env('MYSQL_URL')) ||
    Boolean(env('MYSQL_PUBLIC_URL'));
  const requestedClient = env('DATABASE_CLIENT', hasMysqlFallback ? 'mysql2' : 'sqlite');
  const client = requestedClient === 'mysql' ? 'mysql2' : requestedClient;

  const connections = {
    mysql: {
      connection: {
        host: env('DATABASE_HOST', parsedDatabaseUrl.host ?? fallbackDatabaseHost),
        port: env.int('DATABASE_PORT', parsedDatabaseUrl.port ?? fallbackDatabasePort),
        database: env('DATABASE_NAME', parsedDatabaseUrl.database ?? fallbackDatabaseName),
        user: env('DATABASE_USERNAME', parsedDatabaseUrl.user ?? fallbackDatabaseUser),
        password: env('DATABASE_PASSWORD', parsedDatabaseUrl.password ?? fallbackDatabasePassword),
        ssl: env.bool('DATABASE_SSL', false) && {
          key: env('DATABASE_SSL_KEY', undefined),
          cert: env('DATABASE_SSL_CERT', undefined),
          ca: env('DATABASE_SSL_CA', undefined),
          capath: env('DATABASE_SSL_CAPATH', undefined),
          cipher: env('DATABASE_SSL_CIPHER', undefined),
          rejectUnauthorized: env.bool(
            'DATABASE_SSL_REJECT_UNAUTHORIZED',
            true
          ),
        },
      },
      pool: { min: env.int('DATABASE_POOL_MIN', 2), max: env.int('DATABASE_POOL_MAX', 10) },
    },
    mysql2: {
      connection: {
        host: env('DATABASE_HOST', parsedDatabaseUrl.host ?? fallbackDatabaseHost),
        port: env.int('DATABASE_PORT', parsedDatabaseUrl.port ?? fallbackDatabasePort),
        database: env('DATABASE_NAME', parsedDatabaseUrl.database ?? fallbackDatabaseName),
        user: env('DATABASE_USERNAME', parsedDatabaseUrl.user ?? fallbackDatabaseUser),
        password: env('DATABASE_PASSWORD', parsedDatabaseUrl.password ?? fallbackDatabasePassword),
        ssl: env.bool('DATABASE_SSL', false) && {
          key: env('DATABASE_SSL_KEY', undefined),
          cert: env('DATABASE_SSL_CERT', undefined),
          ca: env('DATABASE_SSL_CA', undefined),
          capath: env('DATABASE_SSL_CAPATH', undefined),
          cipher: env('DATABASE_SSL_CIPHER', undefined),
          rejectUnauthorized: env.bool(
            'DATABASE_SSL_REJECT_UNAUTHORIZED',
            true
          ),
        },
      },
      pool: { min: env.int('DATABASE_POOL_MIN', 2), max: env.int('DATABASE_POOL_MAX', 10) },
    },
    postgres: {
      connection: {
        connectionString: env('DATABASE_URL'),
        host: env('DATABASE_HOST', 'localhost'),
        port: env.int('DATABASE_PORT', 5432),
        database: env('DATABASE_NAME', 'strapi'),
        user: env('DATABASE_USERNAME', 'strapi'),
        password: env('DATABASE_PASSWORD', 'strapi'),
        ssl: env.bool('DATABASE_SSL', false) && {
          key: env('DATABASE_SSL_KEY', undefined),
          cert: env('DATABASE_SSL_CERT', undefined),
          ca: env('DATABASE_SSL_CA', undefined),
          capath: env('DATABASE_SSL_CAPATH', undefined),
          cipher: env('DATABASE_SSL_CIPHER', undefined),
          rejectUnauthorized: env.bool(
            'DATABASE_SSL_REJECT_UNAUTHORIZED',
            true
          ),
        },
        schema: env('DATABASE_SCHEMA', 'public'),
      },
      pool: { min: env.int('DATABASE_POOL_MIN', 2), max: env.int('DATABASE_POOL_MAX', 10) },
    },
    sqlite: {
      connection: {
        filename: path.join(
          __dirname,
          '..',
          '..',
          env('DATABASE_FILENAME', '.tmp/data.db')
        ),
      },
      useNullAsDefault: true,
    },
  };

  return {
    connection: {
      client,
      ...connections[client],
      acquireConnectionTimeout: env.int('DATABASE_CONNECTION_TIMEOUT', 60000),
    },
  };
};
