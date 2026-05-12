const { db } = require('./src/config/firebase');
const bcrypt = require('bcryptjs');

async function seedAdmins() {
  const admins = [
    { username: 'Viswa', name: 'Viswa', password: 'Hexaviswa123' },
    { username: 'Ashvini', name: 'Ashvini', password: 'Hexaashvini123' },
    { username: 'Bharath', name: 'Bharath', password: 'Kingbharath123' }
  ];

  console.log('🚀 Seeding admins...');

  for (const admin of admins) {
    const hashedPassword = await bcrypt.hash(admin.password, 12);

    // Check if exists
    const existing = await db.collection('admins').where('username', '==', admin.username).get();

    if (existing.empty) {
      await db.collection('admins').add({
        username: admin.username,
        full_name: admin.name,
        password: hashedPassword,
        role: 'admin',
        created_at: new Date()
      });
      console.log(`✅ Admin created: ${admin.username}`);
    } else {
      // Update password if already exists
      await existing.docs[0].ref.update({
        password: hashedPassword,
        full_name: admin.name,
        updated_at: new Date()
      });
      console.log(`🔄 Admin updated: ${admin.username}`);
    }
  }

  console.log('✨ All admins seeded successfully!');
  process.exit(0);
}

seedAdmins().catch(err => {
  console.error('❌ Error seeding admins:', err);
  process.exit(1);
});
