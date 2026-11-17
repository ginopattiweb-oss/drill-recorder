import Image from "next/image";

export function LogoMark({ size = 32 }: { size?: number }) {
  return <Image className="logo-mark" src="/icon.svg" width={size} height={size} alt="" />;
}

export function Logo({ size = 32 }: { size?: number }) {
  return (
    <span className="logo">
      <LogoMark size={size} />
      <span className="logo-name"><strong>DRILL</strong> <span>Recorder</span></span>
    </span>
  );
}
