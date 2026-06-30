'use strict';

const { DataTypes } = require('sequelize');

module.exports = (sequelize) =>
  sequelize.define(
    'ApiRequestLog',
    {
      id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
      request_id: { type: DataTypes.CHAR(36), allowNull: false },
      user_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
      user_email: { type: DataTypes.STRING(255), allowNull: true },
      ip_address: { type: DataTypes.STRING(45), allowNull: false },
      http_method: { type: DataTypes.STRING(10), allowNull: false },
      full_url: { type: DataTypes.TEXT, allowNull: false },
      endpoint: { type: DataTypes.STRING(512), allowNull: false },
      route_name: { type: DataTypes.STRING(255), allowNull: true },
      query_params: { type: DataTypes.JSON, allowNull: true },
      request_headers: { type: DataTypes.JSON, allowNull: true },
      request_body: { type: DataTypes.TEXT('long'), allowNull: true },
      uploaded_files: { type: DataTypes.JSON, allowNull: true },
      response_status: { type: DataTypes.INTEGER, allowNull: false },
      response_body: { type: DataTypes.TEXT('long'), allowNull: true },
      execution_time_ms: { type: DataTypes.INTEGER, allowNull: false },
      database_queries: { type: DataTypes.TEXT('long'), allowNull: true },
      database_query_count: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      user_agent: { type: DataTypes.TEXT, allowNull: true },
      referer: { type: DataTypes.TEXT, allowNull: true },
      server_name: { type: DataTypes.STRING(255), allowNull: true },
      environment: { type: DataTypes.STRING(64), allowNull: true },
      exception_message: { type: DataTypes.TEXT, allowNull: true },
      stack_trace: { type: DataTypes.TEXT('long'), allowNull: true },
    },
    {
      tableName: 'api_request_logs',
      underscored: true,
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: false,
    }
  );
