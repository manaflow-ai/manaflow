# freestyle_client.WebApi

All URIs are relative to *https://api.freestyle.sh*

Method | HTTP request | Description
------------- | ------------- | -------------
[**handle_deploy_web_v2**](WebApi.md#handle_deploy_web_v2) | **POST** /web/v1/deployment | Deploy a Website
[**handle_get_web_deploy_details**](WebApi.md#handle_get_web_deploy_details) | **GET** /web/v1/deployments/{deployment_id} | Get information on web deploy
[**handle_list_web_deploys**](WebApi.md#handle_list_web_deploys) | **GET** /web/v1/deployments | List web deploys


# **handle_deploy_web_v2**
> FreestyleDeployWebSuccessResponseV2 handle_deploy_web_v2(freestyle_deploy_web_payload_v2)

Deploy a Website

Deploy a website. Files is a map of file paths to file contents. Configuration is optional and contains additional information about the deployment.

### Example


```python
import freestyle_client
from freestyle_client.models.freestyle_deploy_web_payload_v2 import FreestyleDeployWebPayloadV2
from freestyle_client.models.freestyle_deploy_web_success_response_v2 import FreestyleDeployWebSuccessResponseV2
from freestyle_client.rest import ApiException
from pprint import pprint

# Defining the host is optional and defaults to https://api.freestyle.sh
# See configuration.py for a list of all supported configuration parameters.
configuration = freestyle_client.Configuration(
    host = "https://api.freestyle.sh"
)


# Enter a context with an instance of the API client
with freestyle_client.ApiClient(configuration) as api_client:
    # Create an instance of the API class
    api_instance = freestyle_client.WebApi(api_client)
    freestyle_deploy_web_payload_v2 = freestyle_client.FreestyleDeployWebPayloadV2() # FreestyleDeployWebPayloadV2 | 

    try:
        # Deploy a Website
        api_response = api_instance.handle_deploy_web_v2(freestyle_deploy_web_payload_v2)
        print("The response of WebApi->handle_deploy_web_v2:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling WebApi->handle_deploy_web_v2: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **freestyle_deploy_web_payload_v2** | [**FreestyleDeployWebPayloadV2**](FreestyleDeployWebPayloadV2.md)|  | 

### Return type

[**FreestyleDeployWebSuccessResponseV2**](FreestyleDeployWebSuccessResponseV2.md)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | successfully deployed |  -  |
**400** | Possible errors: WebDeploymentBadRequest, InvalidDomains, EntrypointNotFound, NoEntrypointFound |  -  |
**403** | Possible errors: Forbidden, NoDomainOwnership |  -  |
**404** | Error: DeploymentNotFound |  -  |
**500** | Error: Internal |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **handle_get_web_deploy_details**
> handle_get_web_deploy_details(deployment_id)

Get information on web deploy

Get information about a web deploy by its ID.

### Example


```python
import freestyle_client
from freestyle_client.rest import ApiException
from pprint import pprint

# Defining the host is optional and defaults to https://api.freestyle.sh
# See configuration.py for a list of all supported configuration parameters.
configuration = freestyle_client.Configuration(
    host = "https://api.freestyle.sh"
)


# Enter a context with an instance of the API client
with freestyle_client.ApiClient(configuration) as api_client:
    # Create an instance of the API class
    api_instance = freestyle_client.WebApi(api_client)
    deployment_id = 'deployment_id_example' # str | 

    try:
        # Get information on web deploy
        api_instance.handle_get_web_deploy_details(deployment_id)
    except Exception as e:
        print("Exception when calling WebApi->handle_get_web_deploy_details: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **deployment_id** | **str**|  | 

### Return type

void (empty response body)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: Not defined


[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **handle_list_web_deploys**
> HandleListWebDeploys200Response handle_list_web_deploys(limit, offset)

List web deploys

List web deploys.

### Example


```python
import freestyle_client
from freestyle_client.models.handle_list_web_deploys200_response import HandleListWebDeploys200Response
from freestyle_client.rest import ApiException
from pprint import pprint

# Defining the host is optional and defaults to https://api.freestyle.sh
# See configuration.py for a list of all supported configuration parameters.
configuration = freestyle_client.Configuration(
    host = "https://api.freestyle.sh"
)


# Enter a context with an instance of the API client
with freestyle_client.ApiClient(configuration) as api_client:
    # Create an instance of the API class
    api_instance = freestyle_client.WebApi(api_client)
    limit = 56 # int | Maximum number of repositories to return
    offset = 56 # int | Offset for the list of repositories

    try:
        # List web deploys
        api_response = api_instance.handle_list_web_deploys(limit, offset)
        print("The response of WebApi->handle_list_web_deploys:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling WebApi->handle_list_web_deploys: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **limit** | **int**| Maximum number of repositories to return | 
 **offset** | **int**| Offset for the list of repositories | 

### Return type

[**HandleListWebDeploys200Response**](HandleListWebDeploys200Response.md)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** |  |  -  |
**500** |  |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

