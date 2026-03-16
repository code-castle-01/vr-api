export default {
  /**
   * An asynchronous register function that runs before
   * your application is initialized.
   *
   * This gives you an opportunity to extend code.
   */
  register(/*{ strapi }*/) {},

  /**
   * An asynchronous bootstrap function that runs before
   * your application gets started.
   *
   * This gives you an opportunity to set up your data model,
   * run jobs, or perform some special logic.
   */
  async bootstrap({ strapi }) {
    const xlsx = require('xlsx');
    const path = require('path');
    const fs = require('fs');

    const docDir = path.join(__dirname, '../../doc');
    const xlsPath = path.join(docDir, 'LISTA ASISTENCIA REUNION ASAMBLEA 2026.xls');
    
    if (!fs.existsSync(xlsPath)) return;

    try {
      strapi.log.info('--- PROCESANDO LISTA DE COPROPIETARIOS ---');
      const workbook = xlsx.readFile(xlsPath);
      const data = xlsx.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { header: 1 }) as any[][];
      
      // Obtener el rol de forma segura
      const roles = await strapi.entityService.findMany('plugin::users-permissions.role', {
        filters: { type: 'authenticated' }
      });
      const authRole = roles[0]?.id;

      let count = 0;
      // Empezamos en la fila después de los encabezados
      for (let i = 3; i < data.length; i++) {
        const row = data[i];
        if (row?.[0] && row?.[1]) {
          const casa = row[0].toString().trim();
          const nombre = row[1].toString().trim();
          const email = `${casa.toLowerCase().replace('-', '')}@vegasdelrio.com`;

          const existing = await strapi.query('plugin::users-permissions.user').findOne({
            where: { UnidadPrivada: casa }
          });

          if (!existing) {
            await strapi.plugin('users-permissions').service('user').add({
              username: `${nombre} (${casa})`,
              email,
              password: casa,
              UnidadPrivada: casa,
              Coeficiente: 100,
              EstadoCartera: false,
              confirmed: true,
              role: authRole
            });
            count++;
          }
        }
      }
      if (count > 0) strapi.log.info(`--- IMPORTACIÓN: ${count} USUARIOS NUEVOS ---`);
    } catch (error: any) {
      strapi.log.error('Error en bootstrap: ' + error.message);
    }
  },
};
