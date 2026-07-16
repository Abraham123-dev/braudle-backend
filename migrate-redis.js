import Redis from "ioredis";
import dotenv from "dotenv";

dotenv.config();

const oldRedis = new Redis(process.env.OLD_REDIS_URL);
const newRedis = new Redis(process.env.NEW_REDIS_URL);

async function migrate() {
  let cursor = "0";
  let total = 0;

  do {
    const [nextCursor, keys] = await oldRedis.scan(cursor, "COUNT", 100);
    cursor = nextCursor;

    for (const key of keys) {
      try {
        const type = await oldRedis.type(key);
        const ttl = await oldRedis.pttl(key);

        switch (type) {
          case "string": {
            const value = await oldRedis.get(key);
            await newRedis.set(key, value);
            break;
          }

          case "hash": {
            const value = await oldRedis.hgetall(key);
            if (Object.keys(value).length > 0) {
              await newRedis.hset(key, value);
            }
            break;
          }

          case "list": {
            const value = await oldRedis.lrange(key, 0, -1);
            if (value.length) {
              await newRedis.rpush(key, ...value);
            }
            break;
          }

          case "set": {
            const value = await oldRedis.smembers(key);
            if (value.length) {
              await newRedis.sadd(key, ...value);
            }
            break;
          }

          case "zset": {
            const value = await oldRedis.zrange(key, 0, -1, "WITHSCORES");

            if (value.length) {
              const args = [];

              for (let i = 0; i < value.length; i += 2) {
                args.push(value[i + 1], value[i]);
              }

              await newRedis.zadd(key, ...args);
            }
            break;
          }

          default:
            console.log(`Skipping ${key} (${type})`);
        }

        if (ttl > 0) {
          await newRedis.pexpire(key, ttl);
        }

        console.log(`✅ ${key}`);
        total++;
      } catch (err) {
        console.error(`❌ ${key}:`, err.message);
      }
    }
  } while (cursor !== "0");

  console.log(`\nFinished. Migrated ${total} keys.`);

  oldRedis.disconnect();
  newRedis.disconnect();
}

migrate();