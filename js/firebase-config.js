// Firebase コンソール →「プロジェクトの設定」→「マイアプリ（ウェブ）」に表示される値を貼り付けてください。
// null のままだと「この端末だけ」のローカルランキングで動きます。
//
// ※ apiKey などは公開されても問題ない値です。守りは firestore.rules 側で行います。
//   Google Cloud コンソールで API キーに「ウェブサイトの制限（HTTPリファラー）」を
//   付けておくと、他サイトからの流用をさらに防げます。

export const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyAKFiQfS562WSGZ-TEAMGfJ8GKu0DDShLI',
  authDomain: 'mogumogu-snake-run.firebaseapp.com',
  projectId: 'mogumogu-snake-run',
  appId: '1:1084702646329:web:fd1ff6cd6ecf416fec2de8',
};
/*
const firebaseConfig = {
  apiKey: "AIzaSyAKFiQfS562WSGZ-TEAMGfJ8GKu0DDShLI",
  authDomain: "mogumogu-snake-run.firebaseapp.com",
  projectId: "mogumogu-snake-run",
  storageBucket: "mogumogu-snake-run.firebasestorage.app",
  messagingSenderId: "1084702646329",
  appId: "1:1084702646329:web:fd1ff6cd6ecf416fec2de8"
};
*/
export const FIREBASE_SDK_VERSION = '13.2.0';
