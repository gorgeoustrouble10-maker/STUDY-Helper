# 架构与数据

Next.js App Router提供公开阅读、所有者工作台和Route Handler接口；SQLite和服务端附件目录负责持久化。公开与私密入口共享设计规范，使用不同的信息密度。

Record只保存共用身份、标题、Markdown正文、状态、版本、归档删除和时间。Domain、Course、Project、Action、Issue、Resource、Review、Person、Item、Account、Transaction、Budget、Channel、Publication保存各自业务字段。RecordLink与Tag组织引用和筛选。此结构避免一个万能JSON字段承担全部业务。

对记录的修改使用版本条件更新并保存旧Revision；冲突返回409及服务器版本。重复行动通过唯一previousId保持后续实例唯一。父行动检查循环。

Publication是可继续编辑的稿件；PublishedVersion保存不可变的公开内容快照。currentVersionId决定访客读取的版本，PublishedAsset是独立文件副本。内部素材通过source关系连接，不包含在公开响应中。公开读取动态查询当前版本，无需等待静态索引重建才能撤回。

Review保存用户选择的关联对象快照。后续行动引用复盘，不改变既有证据。项目、课程和领域通过共享关联展示相同记录。

认证使用单Owner和哈希Session。私密路由逐请求校验，修改验证Origin。新对象通过白名单字段校验写入，所有读取分页不产生清理或删除操作。

数据导出在事务中读取业务模型，附件以稳定受控路径打包；恢复只能写入空数据库。个人身份与会话另行初始化。

接口：`/api/auth/login|logout|me`；`/api/workspace/records`与记录操作；profile、files、filters、tags、finance、export、import；`/api/public/content`和当前公开版本附件。
