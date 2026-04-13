import Navbar from "@/components/Navbar";
import Hero from "@/components/Hero";
import HowItWorks from "@/components/HowItWorks";
import WhyCortex from "@/components/WhyCortex";
import PoweredByStellar from "@/components/PoweredByStellar";
import FixedWalletDemo from "@/components/FixedWalletDemo";
import Footer from "@/components/Footer";

export default function Home() {
  return (
    <>
      <Navbar />
      <main>
        <Hero />
        <HowItWorks />
        <WhyCortex />
        <PoweredByStellar />
        <FixedWalletDemo />
      </main>
      <Footer />
    </>
  );
}
