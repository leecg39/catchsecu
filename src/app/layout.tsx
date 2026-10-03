import type { Metadata } from "next";
import { Noto_Sans_KR } from "next/font/google";
import "./globals.css";
const noto=Noto_Sans_KR({variable:"--font-noto",subsets:["latin"],display:"swap"});
export const metadata:Metadata={title:"캐치시큐 데모",description:"캐치시큐 화면을 재현한 로컬 데모",icons:{icon:"/assets/media/logos/favicon.ico"}};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="ko" className={noto.variable}><body>{children}</body></html>}
