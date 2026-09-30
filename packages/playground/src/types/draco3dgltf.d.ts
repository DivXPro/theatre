/**
 * draco3dgltf 没有自带 .d.ts,这里补一个最小声明,
 * 让 TypeScript 认得 createDecoderModule/createEncoderModule。
 */
declare module 'draco3dgltf' {
  export interface DracoDecoderModule {
    // 解码器实例由 gltf-transform 内部消费,这里只声明模块边界。
  }
  export interface DracoEncoderModule {
    // 编码器实例由 gltf-transform 内部消费,这里只声明模块边界。
  }

  interface DracoModuleOptions {
    locateFile?: (file: string) => string
  }

  function createDecoderModule(
    opts?: DracoModuleOptions,
  ): Promise<DracoDecoderModule>
  function createEncoderModule(
    opts?: DracoModuleOptions,
  ): Promise<DracoEncoderModule>

  const draco3dgltf: {
    createDecoderModule: typeof createDecoderModule
    createEncoderModule: typeof createEncoderModule
  }

  export default draco3dgltf
}
