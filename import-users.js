require('dotenv').config();
const xlsx = require('xlsx');
const path = require('path');

const strapi = require('@strapi/strapi');

async function importUsers() {
  const app = await strapi().load();
  
  const docDir = path.join(__dirname, 'doc');
  const xlsPath = path.join(docDir, 'LISTA ASISTENCIA REUNION ASAMBLEA 2026.xls');
  
  console.log('--- LEYENDO EXCEL ---');
  const workbook = xlsx.readFile(xlsPath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const data = xlsx.utils.sheet_to_json(sheet, { header: 1 });
  
  // Asumiendo que las filas de datos empiezan despues del encabezado
  // Formato: [0] CASA, [1] NOMBRE, [2] FIRMA, [3] PODER
  let count = 0;
  for (let i = 3; i < data.length; i++) {
    const row = data[i];
    if (row && row[0] && row[1]) {
      const casa = row[0].toString().trim();
      const nombre = row[1].toString().trim();
      
      const email = `${casa.toLowerCase().replace('-', '')}@vegasdelrio.com`;
      const username = `${nombre} (${casa})`;
      const password = casa; // Password por defecto
      
      try {
        // Checar si el usuario ya existe
        const existing = await app.db.query('plugin::users-permissions.user').findOne({
          where: { UnidadPrivada: casa }
        });
        
        if (!existing) {
          await app.plugin('users-permissions').service('user').add({
            username: username,
            email: email,
            password: password,
            UnidadPrivada: casa,
            Coeficiente: 100, // Por ahora valor default
            EstadoCartera: false,
            confirmed: true
          });
          count++;
          console.log(`Usuario creado: ${username}`);
        }
      } catch (err) {
        console.error(`Error al crear usuario ${username}:`, err.message);
      }
    }
  }
  
  console.log(`\nImportación finalizada. ${count} usuarios nuevos creados.`);
  process.exit(0);
}

importUsers().catch(error => {
  console.error("Error fatal:", error);
  process.exit(1);
});
