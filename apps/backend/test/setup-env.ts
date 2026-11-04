/**
 * Runs before every test file. Points tests at the dedicated test database,
 * never at development or production data.
 */
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://horide:horide_local_dev@localhost:5432/horide_test';
process.env.DATABASE_SSL = 'false';
process.env.CORS_ORIGINS = 'http://localhost:3001';
process.env.SMS_PROVIDER = 'fake';
process.env.ROUTING_PROVIDER = 'fake';
process.env.STORAGE_PROVIDER = 'local';
