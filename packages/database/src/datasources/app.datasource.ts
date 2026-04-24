import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { buildAppDataSourceOptions } from './options';

export const AppDataSource = new DataSource(buildAppDataSourceOptions());
