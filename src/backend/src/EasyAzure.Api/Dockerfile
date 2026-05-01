FROM mcr.microsoft.com/dotnet/aspnet:8.0 AS base
WORKDIR /app
EXPOSE 8080
USER app

FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /src
COPY ["src/EasyAzure.Api/EasyAzure.Api.csproj", "src/EasyAzure.Api/"]
COPY ["src/EasyAzure.Core/EasyAzure.Core.csproj", "src/EasyAzure.Core/"]
COPY ["src/EasyAzure.Discovery/EasyAzure.Discovery.csproj", "src/EasyAzure.Discovery/"]
COPY ["src/EasyAzure.Topology/EasyAzure.Topology.csproj", "src/EasyAzure.Topology/"]
COPY ["src/EasyAzure.DataPath/EasyAzure.DataPath.csproj", "src/EasyAzure.DataPath/"]
COPY ["src/EasyAzure.Designer/EasyAzure.Designer.csproj", "src/EasyAzure.Designer/"]
COPY ["src/EasyAzure.IaC/EasyAzure.IaC.csproj", "src/EasyAzure.IaC/"]
RUN dotnet restore "src/EasyAzure.Api/EasyAzure.Api.csproj"
COPY . .
WORKDIR "/src/src/EasyAzure.Api"
RUN dotnet build "EasyAzure.Api.csproj" -c Release -o /app/build

FROM build AS publish
RUN dotnet publish "EasyAzure.Api.csproj" -c Release -o /app/publish /p:UseAppHost=false

FROM base AS final
WORKDIR /app
COPY --from=publish /app/publish .
ENTRYPOINT ["dotnet", "EasyAzure.Api.dll"]
