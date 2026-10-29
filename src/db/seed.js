import bcrypt from 'bcryptjs';
import db, { initDatabase } from './database.js';

export function seedDatabase() {
  initDatabase();

  console.log('Seeding initial database records...');

  const passwordHash = bcrypt.hashSync('password123', 10);

  // Insert Professor
  db.prepare(`
    INSERT OR IGNORE INTO users (id, name, email, password_hash, role)
    VALUES (1, 'Dr. Alan Turing', 'prof@university.edu', ?, 'PROFESSOR')
  `).run(passwordHash);

  // Insert Students
  db.prepare(`
    INSERT OR IGNORE INTO users (id, name, email, password_hash, role)
    VALUES (2, 'Alice Johnson', 'student1@university.edu', ?, 'STUDENT')
  `).run(passwordHash);

  db.prepare(`
    INSERT OR IGNORE INTO users (id, name, email, password_hash, role)
    VALUES (3, 'Bob Smith', 'student2@university.edu', ?, 'STUDENT')
  `).run(passwordHash);

  db.prepare(`
    INSERT OR IGNORE INTO users (id, name, email, password_hash, role)
    VALUES (4, 'Charlie Davis', 'student3@university.edu', ?, 'STUDENT')
  `).run(passwordHash);

  // Insert Course
  db.prepare(`
    INSERT OR IGNORE INTO courses (id, course_code, name, professor_id)
    VALUES (1, 'SDTT101', 'Software Design & Technology', 1)
  `).run();

  // Enroll Students
  db.prepare(`INSERT OR IGNORE INTO enrollments (student_id, course_id) VALUES (2, 1)`).run();
  db.prepare(`INSERT OR IGNORE INTO enrollments (student_id, course_id) VALUES (3, 1)`).run();
  db.prepare(`INSERT OR IGNORE INTO enrollments (student_id, course_id) VALUES (4, 1)`).run();

  console.log('Database seeded successfully!');
  console.log('----------------------------------------------------');
  console.log('Default Accounts Created:');
  console.log('  Professor: prof@university.edu / password123');
  console.log('  Student 1: student1@university.edu / password123');
  console.log('  Student 2: student2@university.edu / password123');
  console.log('  Student 3: student3@university.edu / password123');
  console.log('----------------------------------------------------');
}

// Run if called directly
if (process.argv[1] && process.argv[1].endsWith('seed.js')) {
  seedDatabase();
}
