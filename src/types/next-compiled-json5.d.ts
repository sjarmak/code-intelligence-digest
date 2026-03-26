declare module "next/dist/compiled/json5" {
  const JSON5: {
    parse(text: string): unknown;
  };

  export default JSON5;
}
