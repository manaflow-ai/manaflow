# freestyle_client.CloudstateApi

All URIs are relative to *https://api.freestyle.sh*

Method | HTTP request | Description
------------- | ------------- | -------------
[**handle_backup_cloudstate**](CloudstateApi.md#handle_backup_cloudstate) | **GET** /cloudstate/v1/projects/{id}/backup | Get Backup of Cloudstate Project
[**handle_deploy_cloudstate**](CloudstateApi.md#handle_deploy_cloudstate) | **POST** /cloudstate/v1/deploy | Deploy Cloudstate Project


# **handle_backup_cloudstate**
> List[int] handle_backup_cloudstate(id)

Get Backup of Cloudstate Project

Get a backup of a cloudstate project

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
    api_instance = freestyle_client.CloudstateApi(api_client)
    id = 'id_example' # str | 

    try:
        # Get Backup of Cloudstate Project
        api_response = api_instance.handle_backup_cloudstate(id)
        print("The response of CloudstateApi->handle_backup_cloudstate:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling CloudstateApi->handle_backup_cloudstate: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **id** | **str**|  | 

### Return type

**List[int]**

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/octet-stream

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | successfully backed up |  -  |
**500** | failed to backup |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **handle_deploy_cloudstate**
> FreestyleCloudstateDeploySuccessResponse handle_deploy_cloudstate(freestyle_cloudstate_deploy_request)

Deploy Cloudstate Project

Deploy a cloudstate project

### Example


```python
import freestyle_client
from freestyle_client.models.freestyle_cloudstate_deploy_request import FreestyleCloudstateDeployRequest
from freestyle_client.models.freestyle_cloudstate_deploy_success_response import FreestyleCloudstateDeploySuccessResponse
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
    api_instance = freestyle_client.CloudstateApi(api_client)
    freestyle_cloudstate_deploy_request = freestyle_client.FreestyleCloudstateDeployRequest() # FreestyleCloudstateDeployRequest | 

    try:
        # Deploy Cloudstate Project
        api_response = api_instance.handle_deploy_cloudstate(freestyle_cloudstate_deploy_request)
        print("The response of CloudstateApi->handle_deploy_cloudstate:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling CloudstateApi->handle_deploy_cloudstate: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **freestyle_cloudstate_deploy_request** | [**FreestyleCloudstateDeployRequest**](FreestyleCloudstateDeployRequest.md)|  | 

### Return type

[**FreestyleCloudstateDeploySuccessResponse**](FreestyleCloudstateDeploySuccessResponse.md)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | successfully deployed |  -  |
**500** | failed to deploy |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

