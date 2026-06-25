import { Nav } from "@/components/landing/Nav";
import { Hero } from "@/components/landing/Hero";
import { HowItWorks } from "@/components/landing/HowItWorks";
import { PlatformShowcase } from "@/components/landing/PlatformShowcase";
import { FAQ } from "@/components/landing/FAQ";
import { Footer } from "@/components/landing/Footer";

export default function LandingPage() {
  return (
    <>
      <Nav />
      <Hero />
      <HowItWorks />
      <PlatformShowcase />
      {/* Pricing hidden during beta — everything is free/open. Re-add <Pricing /> to monetize. */}
      <FAQ />
      <Footer />
    </>
  );
}
