FROM mcr.microsoft.com/dotnet/aspnet:8.0 AS base
WORKDIR /app
USER app

FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /src
COPY ["workers/EasyAzure.DiscoveryWorker/EasyAzure.DiscoveryWorker.csproj", "workers/EasyAzure.DiscoveryWorker/"]
COPY ["backend/src/EasyAzure.Core/EasyAzure.Core.csproj", "backend/src/EasyAzure.Core/"]
COPY ["backend/src/EasyAzure.Discovery/EasyAzure.Discovery.csproj", "backend/src/EasyAzure.Discovery/"]
COPY ["backend/src/EasyAzure.Topology/EasyAzure.Topology.csproj", "backend/src/EasyAzure.Topology/"]
RUN dotnet restore "workers/EasyAzure.DiscoveryWorker/EasyAzure.DiscoveryWorker.csproj"
COPY . .
WORKDIR "/src/workers/EasyAzure.DiscoveryWorker"
RUN dotnet build "EasyAzure.DiscoveryWorker.csproj" -c Release -o /app/build

FROM build AS publish
RUN dotnet publish "EasyAzure.DiscoveryWorker.csproj" -c Release -o /app/publish /p:UseAppHost=false

FROM base AS final
WORKDIR /app
COPY --from=publish /app/publish .
ENTRYPOINT ["dotnet", "EasyAzure.DiscoveryWorker.dll"]
