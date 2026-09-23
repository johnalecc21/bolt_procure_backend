import 'dotenv/config';
import {
  PrismaClient,
  Portal,
  Role,
  EstadoRequerimiento,
  TipoContrato,
  EstadoContrato,
  TipoRegla,
  Prioridad,
  EstadoCaso,
} from '@prisma/client';
import { createClient } from '@supabase/supabase-js';
import { DOCUMENTOS_HOMOLOGACION_INICIALES } from '../src/homologacion/homologacion-documentos.const';

const DOCUMENTOS_OPCIONALES = DOCUMENTOS_HOMOLOGACION_INICIALES.filter((d) => !d.obligatorio);

const prisma = new PrismaClient();
const DEMO_PASSWORD = 'demo123';

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

/** Creates the Supabase Auth user if needed (idempotent) and returns its id. */
async function ensureSupabaseUser(email: string, password: string): Promise<string> {
  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (data?.user) return data.user.id;

  // Already exists from a previous seed run — look it up instead.
  let page = 1;
  while (page < 20) {
    const { data: list, error: listError } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 200 });
    if (listError) throw listError;
    const found = list.users.find((u) => u.email === email);
    if (found) return found.id;
    if (list.users.length < 200) break;
    page += 1;
  }
  throw error ?? new Error(`Could not create or find Supabase user for ${email}`);
}

async function main() {
  console.log('Seeding...');

  // --- Companies -----------------------------------------------------------
  const acme = await prisma.company.upsert({
    where: { id: 'acme' },
    update: {},
    create: { id: 'acme', nombre: 'Acme S.A.' },
  });
  const techcorp = await prisma.company.upsert({
    where: { id: 'techcorp' },
    update: {},
    create: { id: 'techcorp', nombre: 'TechCorp' },
  });
  const procureos = await prisma.company.upsert({
    where: { id: 'procureos' },
    update: {},
    create: { id: 'procureos', nombre: 'ProcureOS' },
  });
  const cloudsphereCo = await prisma.company.upsert({
    where: { id: 'cloudsphere-co' },
    update: {},
    create: { id: 'cloudsphere-co', nombre: 'CloudSphere Technologies' },
  });

  // --- Users -------------------------------------------------------------
  // Each demo user is first created (or reused) as a real Supabase Auth user,
  // then our `public.users` profile row is created with that same id.
  async function upsertUser(email: string, data: {
    nombre: string; portal: Portal; role: Role; iniciales: string; cargo: string;
  }) {
    const id = await ensureSupabaseUser(email, DEMO_PASSWORD);
    return prisma.user.upsert({
      where: { email },
      update: {},
      create: { id, email, ...data },
    });
  }

  const carlos = await upsertUser('carlos@acme.com', {
    nombre: 'Carlos Méndez', portal: Portal.CLIENTE, role: Role.COMPRADOR, iniciales: 'CM', cargo: 'Gerente de Compras',
  });
  const laura = await upsertUser('laura@acme.com', {
    nombre: 'Laura Torres', portal: Portal.CLIENTE, role: Role.COMPRADOR, iniciales: 'LT', cargo: 'Compradora Senior',
  });
  const anaCfo = await upsertUser('ana.cfo@acme.com', {
    nombre: 'Ana Ruiz', portal: Portal.CLIENTE, role: Role.APROBADOR_CFO, iniciales: 'AR', cargo: 'CFO',
  });
  const admin = await upsertUser('admin@acme.com', {
    nombre: 'Roberto Silva', portal: Portal.CLIENTE, role: Role.ADMIN_CLIENTE, iniciales: 'RS', cargo: 'Admin de Cuenta',
  });
  const diego = await upsertUser('contacto@cloudsphere.com', {
    nombre: 'Diego Ramírez', portal: Portal.PROVEEDOR, role: Role.PROVEEDOR, iniciales: 'DR', cargo: 'Gerente Comercial',
  });
  const anaConsultora = await upsertUser('ana.consultora@procureos.com', {
    nombre: 'Ana Consultora', portal: Portal.INTERNO, role: Role.CONSULTOR, iniciales: 'AC', cargo: 'Sourcing Expert',
  });
  const mateo = await upsertUser('compliance@procureos.com', {
    nombre: 'Mateo Vargas', portal: Portal.INTERNO, role: Role.COMPLIANCE_OPS, iniciales: 'MV', cargo: 'Compliance & Ops',
  });

  const membership = (userId: string, companyId: string) =>
    prisma.companyMembership.upsert({
      where: { userId_companyId: { userId, companyId } },
      update: {},
      create: { userId, companyId },
    });
  await membership(carlos.id, acme.id);
  await membership(laura.id, acme.id);
  await membership(anaCfo.id, acme.id);
  await membership(admin.id, acme.id);
  await membership(admin.id, techcorp.id);
  await membership(diego.id, cloudsphereCo.id);
  await membership(anaConsultora.id, procureos.id);
  await membership(mateo.id, procureos.id);

  // --- Matriz de aprobación (una por empresa — cada company necesita la suya,
  // o la pantalla de Matriz de Aprobación no tiene nada que mostrar) ----------
  await prisma.matrizAprobacionRegla.deleteMany({ where: { companyId: acme.id } });
  await prisma.matrizAprobacionRegla.createMany({
    data: [
      { companyId: acme.id, montoMin: 0, montoMax: 10000, roles: [Role.COMPRADOR], tipo: TipoRegla.UNICA },
      { companyId: acme.id, montoMin: 10001, montoMax: 50000, roles: [Role.ADMIN_CLIENTE], tipo: TipoRegla.UNICA },
      { companyId: acme.id, montoMin: 50001, montoMax: 200000, roles: [Role.APROBADOR_CFO], tipo: TipoRegla.SECUENCIAL },
      { companyId: acme.id, montoMin: 200001, montoMax: null, roles: [Role.ADMIN_CLIENTE, Role.APROBADOR_CFO], tipo: TipoRegla.SECUENCIAL },
    ],
  });
  await prisma.matrizAprobacionRegla.deleteMany({ where: { companyId: techcorp.id } });
  await prisma.matrizAprobacionRegla.createMany({
    data: [
      { companyId: techcorp.id, montoMin: 0, montoMax: 15000, roles: [Role.COMPRADOR], tipo: TipoRegla.UNICA },
      { companyId: techcorp.id, montoMin: 15001, montoMax: 100000, roles: [Role.ADMIN_CLIENTE], tipo: TipoRegla.UNICA },
      { companyId: techcorp.id, montoMin: 100001, montoMax: null, roles: [Role.ADMIN_CLIENTE], tipo: TipoRegla.SECUENCIAL },
    ],
  });

  // --- Proveedores (directorio) ----------------------------------------------
  const proveedoresSeed = [
    { id: 'P-001', nombre: 'CloudSphere Technologies', iniciales: 'CS', categorias: ['TI', 'Cloud'], score: 94, ubicacion: 'Bogotá, CO', certificaciones: ['ISO 27001', 'ISO 9001', 'ESG'], procesosGanados: 18, entregasATiempo: 97, color: 'oklch(0.46 0.14 246)', userId: diego.id },
    { id: 'P-002', nombre: 'EcoPack Industrial', iniciales: 'EP', categorias: ['Materia Prima', 'Embalaje'], score: 88, ubicacion: 'Medellín, CO', certificaciones: ['ISO 14001', 'BASC'], procesosGanados: 12, entregasATiempo: 92, color: 'oklch(0.60 0.18 155)' },
    { id: 'P-003', nombre: 'CleanPro Services', iniciales: 'CP', categorias: ['Servicios Generales'], score: 81, ubicacion: 'Cali, CO', certificaciones: ['ISO 9001'], procesosGanados: 9, entregasATiempo: 88, color: 'oklch(0.70 0.18 68)' },
    { id: 'P-004', nombre: 'LogiFleet LATAM', iniciales: 'LF', categorias: ['Logística', 'Transporte'], score: 91, ubicacion: 'Ciudad de México, MX', certificaciones: ['BASC', 'ISO 39001', 'ESG'], procesosGanados: 22, entregasATiempo: 95, color: 'oklch(0.65 0.20 200)' },
    { id: 'P-006', nombre: 'TalentHub Solutions', iniciales: 'TH', categorias: ['RR.HH.', 'Capacitación'], score: 79, ubicacion: 'Santiago, CL', certificaciones: ['ISO 9001'], procesosGanados: 5, entregasATiempo: 84, color: 'oklch(0.60 0.18 230)' },
    { id: 'P-007', nombre: 'AuditTrust Asociados', iniciales: 'AT', categorias: ['Servicios Generales', 'Auditoría'], score: 96, ubicacion: 'Bogotá, CO', certificaciones: ['ISO 9001', 'ISO 27001'], procesosGanados: 14, entregasATiempo: 99, color: 'oklch(0.42 0.13 220)' },
    { id: 'P-008', nombre: 'SoftDesign Studio', iniciales: 'SD', categorias: ['TI', 'Software'], score: 83, ubicacion: 'Buenos Aires, AR', certificaciones: ['ISO 9001', 'ESG'], procesosGanados: 11, entregasATiempo: 89, color: 'oklch(0.70 0.18 200)' },
    { id: 'P-009', nombre: 'GlobalChem Supplies', iniciales: 'GC', categorias: ['Materia Prima', 'Químicos'], score: 87, ubicacion: 'Quito, EC', certificaciones: ['ISO 14001', 'BASC', 'ISO 9001'], procesosGanados: 16, entregasATiempo: 93, color: 'oklch(0.60 0.18 155)' },
    { id: 'P-010', nombre: 'NovaTech Consulting', iniciales: 'NT', categorias: ['TI', 'Consultoría'], score: 92, ubicacion: 'Montevideo, UY', certificaciones: ['ISO 27001', 'ESG', 'ISO 9001'], procesosGanados: 20, entregasATiempo: 96, color: 'oklch(0.50 0.05 240)' },
    { id: 'P-011', nombre: 'PrimeBuild Constructora', iniciales: 'PB', categorias: ['Servicios Generales', 'Construcción'], score: 78, ubicacion: 'Bogotá, CO', certificaciones: ['ISO 9001'], procesosGanados: 8, entregasATiempo: 82, color: 'oklch(0.72 0.18 68)' },
    { id: 'P-012', nombre: 'FleetMaster Logistics', iniciales: 'FM', categorias: ['Logística'], score: 89, ubicacion: 'São Paulo, BR', certificaciones: ['BASC', 'ISO 39001'], procesosGanados: 15, entregasATiempo: 94, color: 'oklch(0.65 0.20 200)' },
  ];
  for (const p of proveedoresSeed) {
    await prisma.proveedorProfile.upsert({
      where: { id: p.id },
      update: {},
      create: { ...p, certificaciones: p.certificaciones },
    });
  }
  const cloudsphereHomologacion = await prisma.homologacion.upsert({
    where: { proveedorId: 'P-001' },
    update: {},
    create: {
      proveedorId: 'P-001',
      estado: 'APROBADO',
      score: 94,
      fechaSolicitud: new Date('2024-02-10'),
      proximaRevalidacion: new Date('2026-02-10'),
    },
  });
  const existingDocs = await prisma.documentoHomologacion.count({
    where: { homologacionId: cloudsphereHomologacion.id },
  });
  if (existingDocs === 0) {
    await prisma.documentoHomologacion.createMany({
      data: [
        { homologacionId: cloudsphereHomologacion.id, nombre: 'RUT / NIT', categoria: 'LEGAL', estado: 'VALIDADO' },
        { homologacionId: cloudsphereHomologacion.id, nombre: 'Estados financieros', categoria: 'FINANCIERO', estado: 'VALIDADO' },
        { homologacionId: cloudsphereHomologacion.id, nombre: 'Certificado ISO 27001', categoria: 'CERTIFICACIONES', estado: 'VALIDADO', vigencia: new Date('2027-03-01') },
        { homologacionId: cloudsphereHomologacion.id, nombre: 'Referencias comerciales', categoria: 'REFERENCIAS', estado: 'VALIDADO' },
        ...DOCUMENTOS_OPCIONALES.map((d) => ({ homologacionId: cloudsphereHomologacion.id, ...d })),
      ],
    });
  }

  // Zona gris queue examples for Compliance
  const zonaGrisIds = ['P-011', 'P-006'];
  for (const [pid, alertas] of [
    ['P-011', ['Certificación ISO 9001 vencida', 'Litigio menor reportado en registro público']],
    ['P-006', ['Antigüedad menor a 2 años']],
  ] as const) {
    await prisma.homologacion.upsert({
      where: { proveedorId: pid },
      update: {},
      create: { proveedorId: pid, estado: 'ZONA_GRIS', score: 62, alertas: [...alertas] },
    });
  }

  // Every other seeded provider needs a real, approved homologacion too — otherwise
  // they're invisible in the directory and can't legally be invited to bid, now that
  // invitations require an approved homologacion.
  for (const p of proveedoresSeed) {
    if (p.id === 'P-001' || (zonaGrisIds as string[]).includes(p.id)) continue;
    const homologacion = await prisma.homologacion.upsert({
      where: { proveedorId: p.id },
      update: {},
      create: { proveedorId: p.id, estado: 'APROBADO', score: p.score, fechaSolicitud: new Date('2024-01-15'), proximaRevalidacion: new Date('2026-01-15') },
    });
    const docsCount = await prisma.documentoHomologacion.count({ where: { homologacionId: homologacion.id } });
    if (docsCount === 0) {
      await prisma.documentoHomologacion.createMany({
        data: [
          { homologacionId: homologacion.id, nombre: 'RUT / NIT', categoria: 'LEGAL', estado: 'VALIDADO' },
          { homologacionId: homologacion.id, nombre: 'Estados financieros', categoria: 'FINANCIERO', estado: 'VALIDADO' },
          { homologacionId: homologacion.id, nombre: 'Certificado ISO / BASC / ESG', categoria: 'CERTIFICACIONES', estado: 'VALIDADO' },
          { homologacionId: homologacion.id, nombre: 'Referencias comerciales', categoria: 'REFERENCIAS', estado: 'VALIDADO' },
          ...DOCUMENTOS_OPCIONALES.map((d) => ({ homologacionId: homologacion.id, ...d })),
        ],
      });
    }
  }

  // --- Requerimientos ----------------------------------------------------
  const reqSeed: {
    id: string; companyId: string; titulo: string; categoria: string;
    estado: EstadoRequerimiento; montoEstimado: number; fechaLimite: string;
    progreso: number; proveedoresInvitados: number; ofertasRecibidas: number; solicitanteId: string;
  }[] = [
    { id: 'RFP-2024-0032', companyId: acme.id, titulo: 'Servicios de nube y migración AWS', categoria: 'TI', estado: 'EN_LICITACION', montoEstimado: 185000, fechaLimite: '2024-08-12', progreso: 45, proveedoresInvitados: 8, ofertasRecibidas: 5, solicitanteId: carlos.id },
    { id: 'RFP-2024-0031', companyId: acme.id, titulo: 'Insumos de embalaje industrial', categoria: 'Materia Prima', estado: 'EN_NEGOCIACION', montoEstimado: 92000, fechaLimite: '2024-08-08', progreso: 70, proveedoresInvitados: 6, ofertasRecibidas: 6, solicitanteId: laura.id },
    { id: 'RFP-2024-0030', companyId: acme.id, titulo: 'Servicios de limpieza corporativa', categoria: 'Servicios Generales', estado: 'ADJUDICADO', montoEstimado: 70000, fechaLimite: '2024-07-30', progreso: 85, proveedoresInvitados: 5, ofertasRecibidas: 4, solicitanteId: carlos.id },
    { id: 'RFP-2024-0029', companyId: acme.id, titulo: 'Flota vehicular logística', categoria: 'Logística', estado: 'EN_CUMPLIMIENTO', montoEstimado: 320000, fechaLimite: '2024-07-15', progreso: 95, proveedoresInvitados: 7, ofertasRecibidas: 7, solicitanteId: anaCfo.id },
    { id: 'RFP-2024-0028', companyId: acme.id, titulo: 'Campaña de marketing digital Q4', categoria: 'Marketing', estado: 'PENDIENTE_APROBACION', montoEstimado: 78000, fechaLimite: '2024-08-20', progreso: 15, proveedoresInvitados: 0, ofertasRecibidas: 0, solicitanteId: laura.id },
    { id: 'RFP-2024-0027', companyId: acme.id, titulo: 'Plataforma de capacitación RR.HH.', categoria: 'RR.HH.', estado: 'BORRADOR', montoEstimado: 45000, fechaLimite: '2024-08-25', progreso: 5, proveedoresInvitados: 0, ofertasRecibidas: 0, solicitanteId: carlos.id },
    { id: 'RFP-2024-0025', companyId: acme.id, titulo: 'Licencias software de diseño', categoria: 'TI', estado: 'CERRADO', montoEstimado: 38000, fechaLimite: '2024-06-15', progreso: 100, proveedoresInvitados: 5, ofertasRecibidas: 5, solicitanteId: carlos.id },
    { id: 'RFP-2024-0044', companyId: techcorp.id, titulo: 'Renovación de licencias Microsoft 365', categoria: 'TI', estado: 'EN_LICITACION', montoEstimado: 96000, fechaLimite: '2024-08-28', progreso: 30, proveedoresInvitados: 4, ofertasRecibidas: 2, solicitanteId: admin.id },
    { id: 'RFP-2024-0045', companyId: techcorp.id, titulo: 'Consultoría de transformación digital', categoria: 'TI', estado: 'ADJUDICADO', montoEstimado: 210000, fechaLimite: '2024-06-20', progreso: 100, proveedoresInvitados: 6, ofertasRecibidas: 5, solicitanteId: admin.id },
  ];
  for (const r of reqSeed) {
    await prisma.requerimiento.upsert({
      where: { id: r.id },
      update: {},
      create: { ...r, fechaLimite: new Date(r.fechaLimite) },
    });
  }

  // --- Ofertas + adjudicación para RFP-2024-0032 -----------------------------
  const ofertas0032 = [
    { proveedorId: 'P-001', precioUnitario: 172000, precioTotal: 172000, plazoEntregaDias: 45, condicionesPagoDias: 30, garantiaMeses: 12, vigenciaOfertaDias: 30, calidad: 92, enviada: true },
    { proveedorId: 'P-010', precioUnitario: 168000, precioTotal: 168000, plazoEntregaDias: 38, condicionesPagoDias: 45, garantiaMeses: 12, vigenciaOfertaDias: 30, calidad: 95, enviada: true },
    { proveedorId: 'P-008', precioUnitario: 155000, precioTotal: 155000, plazoEntregaDias: 52, condicionesPagoDias: 30, garantiaMeses: 12, vigenciaOfertaDias: 30, calidad: 78, enviada: true },
    { proveedorId: 'P-007', precioUnitario: 195000, precioTotal: 195000, plazoEntregaDias: 30, condicionesPagoDias: 60, garantiaMeses: 12, vigenciaOfertaDias: 30, calidad: 96, enviada: true },
  ];
  for (const o of ofertas0032) {
    await prisma.oferta.upsert({
      where: { requerimientoId_proveedorId: { requerimientoId: 'RFP-2024-0032', proveedorId: o.proveedorId } },
      update: {},
      create: { requerimientoId: 'RFP-2024-0032', ...o },
    });
  }
  await prisma.adjudicacion.upsert({
    where: { requerimientoId: 'RFP-2024-0030' },
    update: {},
    create: {
      requerimientoId: 'RFP-2024-0030', proveedorId: 'P-003', precioFinal: 64000,
      plazoDias: 15, condicionesPagoDias: 30, garantiaMeses: 12, poId: 'PO-2024-0040',
      confirmada: true, revisionLegal: true, firmado: true,
    },
  });

  // --- Contratos -------------------------------------------------------------
  const contratosSeed: {
    id: string; companyId: string; tipo: TipoContrato; proveedorNombre: string; categoria: string;
    monto: number; vigenciaInicio: string; vigenciaFin: string; estado: EstadoContrato;
  }[] = [
    { id: 'CTO-2024-0042', companyId: acme.id, tipo: 'CONTRATO', proveedorNombre: 'CloudSphere Technologies', categoria: 'TI', monto: 185000, vigenciaInicio: '2024-01-15', vigenciaFin: '2025-01-14', estado: 'ACTIVO' },
    { id: 'CTO-2024-0041', companyId: acme.id, tipo: 'CONTRATO', proveedorNombre: 'LogiFleet LATAM', categoria: 'Logística', monto: 320000, vigenciaInicio: '2024-02-01', vigenciaFin: '2025-01-31', estado: 'ACTIVO' },
    { id: 'CTO-2024-0040', companyId: acme.id, tipo: 'PO', proveedorNombre: 'CleanPro Services', categoria: 'Servicios Generales', monto: 64000, vigenciaInicio: '2024-07-15', vigenciaFin: '2024-10-15', estado: 'ACTIVO' },
    { id: 'CTO-2024-0039', companyId: acme.id, tipo: 'CONTRATO', proveedorNombre: 'AuditTrust Asociados', categoria: 'Servicios Generales', monto: 58000, vigenciaInicio: '2024-01-01', vigenciaFin: '2024-08-25', estado: 'POR_VENCER' },
    { id: 'CTO-2024-0035', companyId: acme.id, tipo: 'CONTRATO', proveedorNombre: 'NovaTech Consulting', categoria: 'TI', monto: 145000, vigenciaInicio: '2023-12-01', vigenciaFin: '2024-07-31', estado: 'VENCIDO' },
    { id: 'CTO-2024-0046', companyId: techcorp.id, tipo: 'CONTRATO', proveedorNombre: 'NovaTech Consulting', categoria: 'TI', monto: 210000, vigenciaInicio: '2024-06-25', vigenciaFin: '2025-06-24', estado: 'ACTIVO' },
  ];
  for (const c of contratosSeed) {
    await prisma.contrato.upsert({
      where: { id: c.id },
      update: {},
      create: {
        ...c,
        requerimientoId: c.id === 'CTO-2024-0040' ? 'RFP-2024-0030' : undefined,
        vigenciaInicio: new Date(c.vigenciaInicio),
        vigenciaFin: new Date(c.vigenciaFin),
      },
    });
  }

  // Seguimiento hitos on the active CloudSphere contract
  const hitosCount = await prisma.hitoSeguimiento.count({ where: { contratoId: 'CTO-2024-0042' } });
  if (hitosCount === 0) {
    await prisma.hitoSeguimiento.createMany({
      data: [
        { contratoId: 'CTO-2024-0042', label: 'Kickoff del proyecto', comprometido: new Date('2024-08-16'), real: new Date('2024-08-16'), estado: 'COMPLETADO', orden: 0 },
        { contratoId: 'CTO-2024-0042', label: 'Migración fase 1 (5 servidores)', comprometido: new Date('2024-08-30'), real: new Date('2024-08-29'), estado: 'COMPLETADO', orden: 1 },
        { contratoId: 'CTO-2024-0042', label: 'Migración fase 2 (10 servidores)', comprometido: new Date('2024-09-15'), estado: 'EN_RIESGO', orden: 2 },
        { contratoId: 'CTO-2024-0042', label: 'Entrega final y cierre', comprometido: new Date('2024-09-23'), estado: 'PENDIENTE', orden: 3 },
      ],
    });
  }

  // --- Casos consultor ---------------------------------------------------
  const casosCount = await prisma.casoConsultor.count();
  if (casosCount === 0) {
    await prisma.casoConsultor.createMany({
      data: [
        { consultorId: anaConsultora.id, companyId: acme.id, tipo: 'Revisión RFP', prioridad: Prioridad.ALTA, estado: EstadoCaso.EN_PROGRESO },
        { consultorId: anaConsultora.id, companyId: techcorp.id, tipo: 'Negociación', prioridad: Prioridad.MEDIA, estado: EstadoCaso.PENDIENTE },
        { consultorId: anaConsultora.id, companyId: acme.id, tipo: 'Auditoría ahorro', prioridad: Prioridad.MEDIA, estado: EstadoCaso.PENDIENTE },
      ],
    });
  }

  // --- Benchmark de mercado --------------------------------------------
  const benchmarkCount = await prisma.benchmarkEntry.count();
  if (benchmarkCount === 0) {
    await prisma.benchmarkEntry.createMany({
      data: [
        { categoria: 'TI · Cloud', region: 'LATAM', precioPromedio: 172000, muestras: 34, outlier: false },
        { categoria: 'Materia Prima · Embalaje', region: 'LATAM', precioPromedio: 26500, muestras: 58, outlier: false },
        { categoria: 'Servicios Generales · Limpieza', region: 'Colombia', precioPromedio: 61000, muestras: 22, outlier: false },
        { categoria: 'Logística · Flota', region: 'LATAM', precioPromedio: 305000, muestras: 19, outlier: false },
        { categoria: 'TI · Consultoría', region: 'LATAM', precioPromedio: 138000, muestras: 12, outlier: true },
      ],
    });
  }

  console.log('Seed complete.');
  console.log('Demo users (password "demo123" for all, real Supabase Auth accounts):');
  console.log('  Cliente: carlos@acme.com, laura@acme.com, ana.cfo@acme.com, admin@acme.com (multi-empresa)');
  console.log('  Proveedor: contacto@cloudsphere.com');
  console.log('  Interno: ana.consultora@procureos.com, compliance@procureos.com');
  console.log('2FA is opt-in per user now (real TOTP via Supabase) — enable it from Configuración de Cuenta.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
