let SQL = null;

async function initSQL() {
  if (SQL) return SQL;
  const initSqlJs = (await import('sql.js')).default;
  SQL = await initSqlJs({ locateFile: () => '/sql-wasm.wasm' });
  return SQL;
}

export async function openSQLiteFile(file) {
  const sql = await initSQL();
  const buffer = await file.arrayBuffer();
  const db = new sql.Database(new Uint8Array(buffer));

  const res = db.exec(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
  );
  const tables = res[0]?.values.map(r => r[0]) || [];
  return { db, tables };
}

export function readSQLiteTable(db, tableName, limit = 100000) {
  const res = db.exec(`SELECT * FROM "${tableName.replace(/"/g, '""')}" LIMIT ${limit}`);
  if (!res.length) return [];
  const { columns, values } = res[0];
  return values.map(row => {
    const obj = {};
    columns.forEach((col, i) => {
      const v = row[i];
      obj[col] = v === null ? '' : v;
    });
    return obj;
  });
}

export function getSQLiteTableInfo(db, tableName) {
  const res = db.exec(`PRAGMA table_info("${tableName.replace(/"/g, '""')}")`);
  if (!res.length) return { columns: 0, rows: 0 };
  const colCount = res[0].values.length;
  const countRes = db.exec(`SELECT COUNT(*) FROM "${tableName.replace(/"/g, '""')}"`);
  const rows = countRes[0]?.values[0][0] ?? 0;
  return { columns: colCount, rows };
}
