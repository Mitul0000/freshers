"use client";

import useScrollReveal from "@/lib/useScrollReveal";
import OrnateFrame from "@/components/OrnateFrame";
import Navigation from "@/components/Navigation";
import Hero from "@/components/Hero";
import CinematicArchive from "@/components/CinematicArchive";
import InvitationSection from "@/components/InvitationSection";
import TheNight from "@/components/TheNight";
import TheFamilies from "@/components/TheFamilies";
import RegistrationDossiers from "@/components/RegistrationDossiers";
import StatementBreak from "@/components/StatementBreak";
import Footer from "@/components/Footer";

export default function Home() {
  useScrollReveal();

  return (
    <>
      <OrnateFrame />
      <div className="grain" />
      <div className="scratches" />

      <Navigation />
      <main>
        <Hero />
        <CinematicArchive />
        <InvitationSection />
        <TheNight />
        <TheFamilies />
        <RegistrationDossiers />
        <StatementBreak />
      </main>
      <Footer />
    </>
  );
}
