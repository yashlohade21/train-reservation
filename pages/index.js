import { useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import styles from '../styles/Home.module.css';

export default function Home() {
  return (
    <div className={styles.container}>
      <Head>
        <title>Train Seat Reservation</title>
        <meta name="description" content="Book train seats online" />
      </Head>

      <main className={styles.main}>
        <h1 className={styles.title}>
          Welcome to Train Seat Reservation
        </h1>

        <div className={styles.grid}>
          <Link href="/login" className={styles.card}>
            <h2>Login &rarr;</h2>
            <p>Access your account to book seats</p>
          </Link>

          <Link href="/signup" className={styles.card}>
            <h2>Sign Up &rarr;</h2>
            <p>Create a new account to get started</p>
          </Link>
        </div>
      </main>
    </div>
  );
}