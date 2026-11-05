// Firebase コンソール →「プロジェクトの設定」→「マイアプリ（ウェブ）」に表示される値を貼り付けてください。
// null のままだと「この端末だけ」のローカルランキングで動きます。
//
// ※ apiKey などは公開されても問題ない値です。守りは firestore.rules 側で行います。
//   Google Cloud コンソールで API キーに「ウェブサイトの制限（HTTPリファラー）」を
//   付けておくと、他サイトからの流用をさらに防げます。

export const FIREBASE_CONFIG = null;
/*
export const FIREBASE_CONFIG = {
  apiKey: '...',
  authDomain: '...firebaseapp.com',
  projectId: '...',
  appId: '...',
};
*/

export const FIREBASE_SDK_VERSION = '13.2.0';
