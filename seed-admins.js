const { db } = require('./src/config/firebase');
const bcrypt = require('bcryptjs');

async function seedAdmins() {
  const admins = [
    { username: 'Viswa', name: 'Viswa', password: 'Hexaviswa123', email: 'viswaviswa440@gmail.com' },
    { username: 'Ashvini', name: 'Ashvini', password: 'Hexaashvini123', email: 'ashviniashvini2107@gmail.com' },
    { username: 'Bharath', name: 'Bharath', password: 'Kingbharath123', email: 'bharathv1004@gmail.com' }
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
        email: admin.email,
        password: hashedPassword,
        role: 'admin',
        created_at: new Date()
      });
      console.log(`✅ Admin created: ${admin.username}`);
    } else {
      // Update password and email if already exists
      await existing.docs[0].ref.update({
        password: hashedPassword,
        full_name: admin.name,
        email: admin.email,
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
